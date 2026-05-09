'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require('electron');

const i18n = require('./i18n');
const { Logger } = require('./logger');
const { getPaths, getSillyTavernResourcePath, getBundledNodePath } = require('./paths');
const { pickEphemeralPort } = require('./port');
const { ServiceController } = require('./lifecycle');
const { buildMenu } = require('./menu');
const { silentCheck, showServiceCrashedBanner } = require('./updater');

// SPEC §一-5 ("可自助排错") requires a visible error path even when startup
// blows up before the splash exists. The in-app Logger only comes online after
// getPaths() / mkdirSync succeed; if anything before that throws (e.g. portable
// extraction landed in a path Defender or a security suite blocks from writing),
// we'd be left with a zombie process and zero feedback. Derive a writable log
// directory directly from the OS env so we can dump a crash file even without
// app.getPath(), and pair it with dialog.showErrorBox — one of the few Electron
// APIs callable before app is ready, so module-load and pre-whenReady throws
// still surface a native message box.
function fallbackLogDir() {
  const root = process.env.APPDATA
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : null)
    || (process.env.HOME ? path.join(process.env.HOME, '.config') : null)
    || os.tmpdir();
  return path.join(root, 'EazySillyTavern', 'logs');
}

function writeCrashLog(message) {
  try {
    const dir = fallbackLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `crash-${Date.now()}.log`);
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
    return file;
  } catch {
    return null;
  }
}

function reportFatal(prefix, err) {
  const detail = (err && (err.stack || err.message)) || String(err);
  const logFile = writeCrashLog(`${prefix}: ${detail}`);
  try {
    const tail = logFile ? `\n\nLog: ${logFile}` : '';
    dialog.showErrorBox('EazySillyTavern failed to start', `${prefix}\n\n${detail}${tail}`);
  } catch {
    /* nothing left to do */
  }
}

process.on('uncaughtException', (err) => {
  reportFatal('Uncaught exception', err);
  // Electron can keep an Electron process alive after an uncaught exception
  // when no window has opened yet — exactly the "process running, no window"
  // failure mode this guard exists to prevent. Force-exit so a stuck launch
  // doesn't leave an invisible zombie process the user has to find in Task Manager.
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  reportFatal('Unhandled rejection', err);
  process.exit(1);
});

// Disable Chromium subsystems EazySillyTavern never uses. Translate prompts
// and Autofill server pings make no sense in a localhost-only single-page app;
// CalculateNativeWinOcclusion has caused Windows window-flicker bugs in past
// Electron releases and burns a small amount of CPU on every paint.
app.commandLine.appendSwitch('disable-features', 'Translate,AutofillServerCommunication,CalculateNativeWinOcclusion');

// Keep SillyTavern's renderer fully responsive even when the window is
// blurred / occluded / minimized. Chromium's defaults throttle setTimeout /
// setInterval to 1Hz and lower renderer process priority when not foreground —
// fine for a generic browser, harmful for a chat app that streams tokens and
// polls model state. The BrowserWindow-level `backgroundThrottling: false`
// covers timer throttling per-window, but the process-priority and occlusion
// behaviors only respond to these process-wide switches.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const SPLASH_WIDTH = 460;
const SPLASH_HEIGHT = 240;
const MAIN_WIDTH = 1400;
const MAIN_HEIGHT = 900;

let logger = null;
let paths = null;
let splashWindow = null;
let mainWindow = null;
let service = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.focus();
  }
});

function createSplashWindow() {
  // Show the splash immediately rather than waiting on `ready-to-show`. On
  // Windows portable builds we've seen the event silently never fire under
  // some AV / GPU compositor combinations, leaving the user with the exact
  // "process running, no window" symptom this code path is supposed to prevent.
  // backgroundColor matches the splash CSS, so the brief moment before the
  // HTML paints is a dark window — not a white flash.
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    transparent: false,
    backgroundColor: '#111827',
    show: true,
    skipTaskbar: false,
    title: 'EazySillyTavern',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'splash-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'splash', 'splash.html'));
  return win;
}

// IPC dispatch helpers buffer messages sent before the splash webContents
// finishes loading. Without this, an immediate failure (e.g. missing_bundle)
// dispatches splash:error before the renderer is ready and the message is
// silently dropped, leaving the splash stuck on the loading state.
const splashOutbox = [];
let splashReady = false;

function flushSplashOutbox() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  while (splashOutbox.length > 0) {
    const { channel, payload } = splashOutbox.shift();
    splashWindow.webContents.send(channel, payload);
  }
}

function postToSplash(channel, payload) {
  if (splashReady && splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send(channel, payload);
  } else {
    splashOutbox.push({ channel, payload });
  }
}

function createMainWindow(serviceUrl) {
  // Make the OS title bar match SillyTavern's dark theme without hiding it:
  // macOS keeps the native title bar (dark theme is forced via nativeTheme so
  // it stays dark even on a light-mode system); Windows hides the native bar
  // and uses titleBarOverlay to paint the controls strip in matching #111827.
  const titleBarOpts = process.platform === 'win32'
    ? {
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#111827', symbolColor: '#e5e7eb', height: 32 },
      }
    : {};
  const win = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#111827',
    title: 'EazySillyTavern',
    ...titleBarOpts,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // SillyTavern is served from 127.0.0.1, so default sandboxing is fine.
      enableWebSQL: false,
      // Cache compiled bytecode so SillyTavern's heavy JS bundles parse
      // faster on subsequent reloads (settings change, full refresh, etc.).
      v8CacheOptions: 'code',
      // Don't throttle SillyTavern's timers when the window is in the
      // background. Streaming responses, autosave loops, and websocket
      // keepalives need to keep ticking even if the user is in another app.
      backgroundThrottling: false,
    },
  });
  win.loadURL(serviceUrl);
  win.once('ready-to-show', () => win.show());

  // Windows' titleBarOverlay only paints its own button strip; the rest of the
  // top edge is page content and needs a draggable region we inject ourselves.
  // Re-inject on every load (SillyTavern is an SPA but full reloads do happen,
  // e.g. settings changes). macOS uses the native title bar and doesn't need this.
  if (process.platform === 'win32') {
    const dragRegionScript = buildDragRegionScript();
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(dragRegionScript).catch(() => { /* ignore */ });
    });
  }

  // Open links that target _blank in the system browser, do not let SillyTavern spawn child windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', () => {
    isQuitting = true;
  });
  return win;
}

function buildDragRegionScript() {
  // Windows-only: titleBarOverlay covers the right-edge button strip (~140px);
  // the rest of the top has to be a draggable region we inject ourselves.
  const rightGap = 140;
  const height = 32;
  return `
    (() => {
      const id = 'eazy-drag-region';
      if (document.getElementById(id)) return;
      const root = document.documentElement;
      const drag = document.createElement('div');
      drag.id = id;
      drag.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'right:${rightGap}px',
        'height:${height}px',
        '-webkit-app-region:drag',
        'z-index:2147483647',
        'pointer-events:auto',
      ].join(';');
      root.appendChild(drag);
    })();
  `;
}

function setStatus(key, vars) {
  postToSplash('splash:status', i18n.t(key, vars));
}

function setError(key, vars) {
  postToSplash('splash:error', i18n.t(key, vars));
}

function wireSplashIpc() {
  ipcMain.on('splash:request-strings', (event) => {
    // The splash sends this once its preload + script have run, so it doubles
    // as our "renderer is alive" signal — flush anything we tried to send before.
    splashReady = true;
    event.sender.send('splash:strings', i18n.getAllStrings());
    flushSplashOutbox();
  });
  ipcMain.on('splash:view-log', () => {
    if (logger) shell.showItemInFolder(logger.filePath);
    else if (paths) shell.openPath(paths.logs);
  });
  ipcMain.on('splash:quit', () => {
    isQuitting = true;
    app.quit();
  });
}

async function bootstrap() {
  // Steps below run before the splash exists; if any throws we have to surface
  // the failure ourselves (native dialog + crash log), otherwise the app is
  // invisible to the user. Each step gets its own message because the typical
  // failure modes are very different: missing i18n bundle, blocked %APPDATA%
  // directory, or a log file the OS won't open.
  try {
    i18n.init();
  } catch (err) {
    reportFatal('Failed to load translations', err);
    process.exit(1);
  }
  try {
    paths = getPaths();
  } catch (err) {
    reportFatal('Failed to prepare app data directories', err);
    process.exit(1);
  }
  try {
    logger = new Logger(paths.logs);
  } catch (err) {
    reportFatal('Failed to open startup log', err);
    process.exit(1);
  }
  logger.info(`EazySillyTavern ${app.getVersion()} starting (locale=${i18n.getLocale()})`);
  logger.info(`User data root: ${paths.root}`);

  const stRoot = getSillyTavernResourcePath();
  const nodeBinaryPath = getBundledNodePath();
  logger.info(`SillyTavern resource path: ${stRoot}`);
  logger.info(`Bundled Node binary: ${nodeBinaryPath}`);

  splashWindow = createSplashWindow();

  buildMenu({ logger, paths, getMainWindow: () => mainWindow });

  service = new ServiceController({
    logger,
    paths,
    sillyTavernRoot: stRoot,
    nodeBinaryPath,
    getPort: pickEphemeralPort,
  });

  service.onExit(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
      showServiceCrashedBanner(mainWindow);
      logger.warn('SillyTavern child exited after ready; banner shown.');
    }
  });

  // Only the last status before the await would ever be visible — the IPC
  // sends are synchronous on this side but the renderer applies them in a
  // single tick before paint, so the user just sees "Spawning…". Keep the
  // most informative one and drop the noise.
  setStatus('splash.startingService');

  const result = await service.start();

  if (result.status !== 'ready') {
    const errorKey = mapFailureKey(result.reason);
    setError(errorKey);
    return;
  }

  const serviceUrl = `http://127.0.0.1:${result.port}/`;
  logger.info(`Loading main window: ${serviceUrl}`);
  mainWindow = createMainWindow(serviceUrl);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
  });

  // Per SPEC §六-6: silent check ~3s after startup, non-blocking.
  setTimeout(() => { silentCheck(logger, mainWindow).catch((e) => logger.warn(String(e))); }, 3000);
}

function mapFailureKey(reason) {
  switch (reason) {
    case 'port_failed': return 'splash.error.portFailed';
    case 'service_crashed': return 'splash.error.serviceCrashed';
    case 'timeout': return 'splash.error.timeout';
    case 'missing_bundle': return 'splash.error.serviceCrashed';
    case 'fork_failed': return 'splash.error.serviceCrashed';
    default: return 'splash.error.unknown';
  }
}

app.on('window-all-closed', () => {
  // SPEC §五-3.3: closing the main window quits the app on every platform, including macOS.
  isQuitting = true;
  app.quit();
});

app.on('before-quit', async (event) => {
  if (!service) return;
  if (service.getStatus().status === 'idle') return;
  if (service.getStatus().status === 'exited') return;
  // We don't want to lose the chance to clean up the child.
  // Async cleanup before quit: prevent default once, then quit after stop().
  if (!service._cleanupStarted) {
    service._cleanupStarted = true;
    event.preventDefault();
    try { await service.stop(); } catch (e) { logger?.warn(String(e)); }
    logger?.info('Child stopped, quitting Electron.');
    logger?.close();
    app.quit();
  }
});

app.whenReady().then(() => {
  // Force dark theme on native chrome (title bar, menus, dialogs) so it
  // matches SillyTavern's dark UI even when the OS is in light mode.
  nativeTheme.themeSource = 'dark';
  wireSplashIpc();
  bootstrap().catch((err) => {
    // Splash exists by this point if bootstrap got past its early steps, so
    // try to surface the message there too — but always fall back to a native
    // dialog so the user can never end up with an invisible failure.
    logger?.error(`Bootstrap crashed: ${err.stack || err.message}`);
    setError('splash.error.unknown');
    reportFatal('Bootstrap crashed', err);
    process.exit(1);
  });
});
