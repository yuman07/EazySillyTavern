'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 20;

// In a packaged Electron app there's no controlling terminal, so writing every
// log line to process.stdout/stderr just enqueues bytes into a pipe nothing
// reads. Detect that once at module load and skip the duplicate I/O — saves a
// syscall per log line and a small amount of GC pressure when SillyTavern is
// chatty (it logs every HTTP request).
const HAS_CONSOLE = Boolean(process.stdout && process.stdout.isTTY)
  || Boolean(process.stderr && process.stderr.isTTY);

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function rollOldLogs(logsDir) {
  let entries;
  try {
    entries = fs.readdirSync(logsDir)
      .filter((f) => f.startsWith('startup-') && f.endsWith('.log'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }
  for (const old of entries.slice(MAX_FILES - 1)) {
    try { fs.unlinkSync(path.join(logsDir, old.name)); } catch { /* ignore */ }
  }
}

class Logger {
  constructor(logsDir) {
    this.logsDir = logsDir;
    fs.mkdirSync(logsDir, { recursive: true });
    rollOldLogs(logsDir);
    this.filePath = path.join(logsDir, `startup-${timestampForFilename()}.log`);
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
  }

  _write(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    this.stream.write(line);
    if (HAS_CONSOLE) {
      if (level === 'ERROR') process.stderr.write(line);
      else process.stdout.write(line);
    }
  }

  info(msg) { this._write('INFO', msg); }
  warn(msg) { this._write('WARN', msg); }
  error(msg) { this._write('ERROR', msg); }

  pipeChild(child) {
    // Use stream.pipe instead of `data` event listeners so the kernel/libuv
    // can hand bytes straight to the log file without bouncing every chunk
    // through a JS callback. Critical for SillyTavern's verbose request log
    // which can emit many small writes per second under load. `end: false`
    // because both child stdout & stderr feed the same sink — we don't want
    // the first one to close to tear down the file stream.
    if (child.stdout) child.stdout.pipe(this.stream, { end: false });
    if (child.stderr) child.stderr.pipe(this.stream, { end: false });
  }

  close() {
    try { this.stream.end(); } catch { /* ignore */ }
  }
}

module.exports = { Logger };
