'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const i18n = require('./i18n');
const { Logger } = require('./logger');
const { getPaths, getSillyTavernResourcePath, getBundledNodePath } = require('./paths');
const { pickEphemeralPort } = require('./port');
const { ServiceController } = require('./lifecycle');
const { buildMenu } = require('./menu');
const { silentCheck, showServiceCrashedBanner } = require('./updater');

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
  const win = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#111827',
    title: 'EazySillyTavern',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // SillyTavern is served from 127.0.0.1, so default sandboxing is fine.
    },
  });
  win.loadURL(serviceUrl);
  win.once('ready-to-show', () => win.show());

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

  setStatus('splash.preparingData');
  setStatus('splash.pickingPort');
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
  wireSplashIpc();
  bootstrap().catch((err) => {
    logger?.error(`Bootstrap crashed: ${err.stack || err.message}`);
    setError('splash.error.unknown');
  });
});
