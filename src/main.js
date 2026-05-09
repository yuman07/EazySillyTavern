'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require('electron');

const i18n = require('./i18n');
const { Logger } = require('./logger');
const { getPaths, getSillyTavernResourcePath, getBundledNodePath } = require('./paths');
const { pickEphemeralPort } = require('./port');
const { ServiceController } = require('./lifecycle');
const { buildMenu } = require('./menu');
const { silentCheck, showServiceCrashedBanner } = require('./updater');

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

// Windows taskbar otherwise picks up Electron's default atom icon for our
// BrowserWindows. The .ico embedded in the .exe by electron-builder controls
// the file icon in Explorer, not the live window icon — that's the BrowserWindow
// `icon` option. Resolved off app.getAppPath() so it works the same in dev and
// inside the packaged asar (build/icon.png is included via electron-builder.yml).
function getAppIconPath() {
  return path.join(app.getAppPath(), 'build', 'icon.png');
}

function createSplashWindow() {
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    transparent: false,
    backgroundColor: '#111827',
    show: false,
    skipTaskbar: false,
    title: 'EazySillyTavern',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'splash-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'splash', 'splash.html'));
  win.once('ready-to-show', () => win.show());
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
    icon: getAppIconPath(),
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
  i18n.init();
  paths = getPaths();
  logger = new Logger(paths.logs);
  logger.info(`EazySillyTavern ${app.getVersion()} starting (locale=${i18n.getLocale()})`);
  logger.info(`User data root: ${paths.root}`);

  const stRoot = getSillyTavernResourcePath();
  const nodeBinaryPath = getBundledNodePath();
  logger.info(`SillyTavern resource path: ${stRoot}`);
  logger.info(`Bundled Node binary: ${nodeBinaryPath}`);

  // First run = SillyTavern hasn't yet populated dataRoot. Its default-user
  // directory is created on initial launch when the bundled default content
  // (~150 files: backgrounds, presets, characters) is copied in. That copy +
  // first-time webpack compile of frontend libs is what blows past the warm
  // launch budget on Windows portable / cold disks.
  const firstRun = !fs.existsSync(path.join(paths.data, 'default-user'));
  if (firstRun) logger.info('First run detected — surfacing the slow-startup hint.');

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
  if (firstRun) postToSplash('splash:hint', i18n.t('splash.firstRun.hint'));

  const result = await service.start();

  if (result.status === 'aborted') {
    // User asked to quit before the service came up. before-quit is already
    // tearing things down — don't paint an error on a splash that's about
    // to disappear.
    return;
  }
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
    logger?.error(`Bootstrap crashed: ${err.stack || err.message}`);
    setError('splash.error.unknown');
  });
});
