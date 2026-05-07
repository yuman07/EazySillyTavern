'use strict';

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const READY_POLL_INTERVAL_MS = 200;
const READY_POLL_TIMEOUT_MS = 1000;
const READY_TOTAL_TIMEOUT_MS = 30_000;
const SHUTDOWN_GRACE_MS = 5_000;
const PORT_RETRY_LIMIT = 3;

function buildArgs({ port, dataRoot, configPath }) {
  return [
    `--port=${port}`,
    '--listen=false',
    '--listenAddressIPv4=127.0.0.1',
    '--enableIPv4=true',
    '--enableIPv6=false',
    `--dataRoot=${dataRoot}`,
    `--configPath=${configPath}`,
    '--basicAuthMode=false',
    '--whitelist=false',
    '--browserLaunchEnabled=false',
    '--corsProxy=false',
  ];
}

function buildEnv() {
  // Strip ELECTRON_* keys so the bundled Node binary doesn't think it's running under Electron.
  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('ELECTRON_')) continue;
    cleanEnv[k] = v;
  }
  // Cap heap at 2GB (well above SillyTavern's typical footprint) to bound
  // runaway leaks; silence Node deprecation noise so the child log file stays
  // focused on SillyTavern's own output. Append to any user-provided
  // NODE_OPTIONS so we don't clobber an explicit override.
  const ourNodeOptions = '--max-old-space-size=2048 --no-warnings';
  const nodeOptions = cleanEnv.NODE_OPTIONS
    ? `${ourNodeOptions} ${cleanEnv.NODE_OPTIONS}`
    : ourNodeOptions;
  return {
    ...cleanEnv,
    NODE_ENV: 'production',
    NODE_OPTIONS: nodeOptions,
    SILLYTAVERN_ENABLEUSERACCOUNTS: 'false',
  };
}

function probeOnce(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: READY_POLL_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve({ ok: true, status: res.statusCode });
      },
    );
    req.on('error', (err) => resolve({ ok: false, error: err }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function waitForReady(port, child, signal) {
  const startedAt = Date.now();
  while (true) {
    if (signal.aborted) return { status: 'aborted' };
    if (signal.childExited) return { status: 'failed', reason: 'service_crashed' };
    if (Date.now() - startedAt > READY_TOTAL_TIMEOUT_MS) {
      return { status: 'failed', reason: 'timeout' };
    }
    const probe = await probeOnce(port);
    if (probe.ok) {
      return { status: 'ready' };
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
}

class ServiceController {
  constructor({ logger, paths, sillyTavernRoot, nodeBinaryPath, getPort }) {
    this.logger = logger;
    this.paths = paths;
    this.sillyTavernRoot = sillyTavernRoot;
    this.nodeBinaryPath = nodeBinaryPath;
    this.getPort = getPort;
    this.state = {
      port: null,
      childPid: null,
      status: 'idle',
      startedAt: null,
      readyAt: null,
      failureReason: null,
    };
    this.child = null;
    this.signal = { aborted: false, childExited: false };
    this._exitListeners = [];
  }

  onExit(fn) { this._exitListeners.push(fn); }

  async start() {
    let lastError = null;
    for (let attempt = 1; attempt <= PORT_RETRY_LIMIT; attempt++) {
      const result = await this._startOnce(attempt);
      if (result.status === 'ready') return result;
      lastError = result;
      // Only retry if the failure was port-related (child crashed immediately with EADDRINUSE).
      if (result.reason !== 'service_crashed') break;
      this.logger.warn(`Service crashed on attempt ${attempt}; retrying with a fresh port…`);
    }
    return lastError ?? { status: 'failed', reason: 'unknown' };
  }

  async _startOnce(attempt) {
    let port;
    try {
      port = await this.getPort();
    } catch (err) {
      this.logger.error(`Port allocation failed (attempt ${attempt}): ${err.stack || err.message}`);
      return { status: 'failed', reason: 'port_failed' };
    }

    const args = buildArgs({
      port,
      dataRoot: this.paths.data,
      configPath: this.paths.sillyTavernConfig,
    });
    const serverEntry = path.join(this.sillyTavernRoot, 'server.js');

    if (!fs.existsSync(serverEntry)) {
      this.logger.error(`SillyTavern entry not found at ${serverEntry}. Was the bundle prepared?`);
      return { status: 'failed', reason: 'missing_bundle' };
    }
    if (!fs.existsSync(this.nodeBinaryPath)) {
      this.logger.error(`Bundled Node binary not found at ${this.nodeBinaryPath}. Was prep:sillytavern run?`);
      return { status: 'failed', reason: 'missing_bundle' };
    }

    const spawnArgs = [serverEntry, ...args];
    this.logger.info(`Starting SillyTavern: ${this.nodeBinaryPath} ${spawnArgs.join(' ')}`);

    const signal = { aborted: false, childExited: false };
    this.signal = signal;

    let child;
    try {
      child = spawn(this.nodeBinaryPath, spawnArgs, {
        cwd: this.sillyTavernRoot,
        env: buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      this.logger.error(`Failed to spawn SillyTavern: ${err.stack || err.message}`);
      return { status: 'failed', reason: 'fork_failed' };
    }

    this.child = child;
    this.state = {
      port,
      childPid: child.pid,
      status: 'starting',
      startedAt: Date.now(),
      readyAt: null,
      failureReason: null,
    };
    this.logger.pipeChild(child);

    child.on('exit', (code, sig) => {
      this.logger.info(`SillyTavern child exited code=${code} signal=${sig}`);
      signal.childExited = true;
      const prevStatus = this.state.status;
      this.state.status = 'exited';
      // Only treat this as a runtime crash if we did not initiate the shutdown
      // ourselves (signal.aborted is set by stop()).
      if (prevStatus === 'ready' && !signal.aborted) {
        for (const fn of this._exitListeners) {
          try { fn({ code, signal: sig }); } catch (e) { this.logger.error(String(e)); }
        }
      }
    });
    child.on('error', (err) => {
      this.logger.error(`SillyTavern child error: ${err.stack || err.message}`);
      signal.childExited = true;
    });

    const result = await waitForReady(port, child, signal);
    if (result.status === 'ready') {
      this.state.status = 'ready';
      this.state.readyAt = Date.now();
      this.logger.info(`SillyTavern ready on port ${port} after ${this.state.readyAt - this.state.startedAt} ms`);
      return { status: 'ready', port };
    }
    this.state.status = 'failed';
    this.state.failureReason = result.reason;
    this.logger.error(`SillyTavern failed to become ready: ${result.reason}`);
    // Try to kill the child if it's still around so we don't orphan.
    this._killChild();
    return { status: 'failed', reason: result.reason };
  }

  _killChild() {
    const child = this.child;
    if (!child || child.killed) return;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      try { if (!child.killed) child.kill('SIGKILL'); } catch { /* ignore */ }
    }, SHUTDOWN_GRACE_MS).unref();
  }

  async stop() {
    this.signal.aborted = true;
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null) return;
    return new Promise((resolve) => {
      let killTimer;
      const finish = () => {
        if (killTimer) clearTimeout(killTimer);
        resolve();
      };
      child.once('exit', finish);
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, SHUTDOWN_GRACE_MS);
      killTimer.unref();
    });
  }

  getStatus() { return { ...this.state }; }
}

module.exports = { ServiceController };
