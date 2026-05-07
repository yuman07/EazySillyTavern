'use strict';

const https = require('node:https');
const { app, dialog, shell } = require('electron');
const { t } = require('./i18n');

const REPO_OWNER = 'yuman07';
const REPO_NAME = 'EazySillyTavern';
const REQUEST_TIMEOUT_MS = 8000;

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': `EazySillyTavern/${app.getVersion()}`,
        'Accept': 'application/vnd.github+json',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API responded with ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function isPlaceholderRepo() {
  return REPO_OWNER === 'OWNER_PLACEHOLDER' || REPO_NAME === 'REPO_PLACEHOLDER';
}

function releasesPageUrl() {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
}

async function checkForUpdates() {
  if (isPlaceholderRepo()) {
    return { state: 'skipped', reason: 'placeholder_repo' };
  }
  try {
    const release = await fetchLatestRelease();
    const latest = release.tag_name || release.name || '';
    const cmp = compareVersions(latest, app.getVersion());
    if (cmp > 0) {
      return { state: 'available', latest, releaseUrl: release.html_url || releasesPageUrl() };
    }
    return { state: 'up_to_date', latest };
  } catch (err) {
    return { state: 'failed', error: err };
  }
}

async function silentCheck(logger, mainWindow) {
  const result = await checkForUpdates();
  if (result.state === 'available') {
    logger.info(`Update available: ${result.latest}`);
    showUpdateBanner(mainWindow, result.latest, result.releaseUrl);
  } else if (result.state === 'failed') {
    logger.warn(`Update check failed: ${result.error?.message || result.error}`);
  } else if (result.state === 'skipped') {
    logger.info('Update check skipped: repository placeholder still in code.');
  } else {
    logger.info(`Up to date: ${result.latest}`);
  }
}

async function manualCheck(logger, mainWindow) {
  const result = await checkForUpdates();
  if (result.state === 'available') {
    logger.info(`Update available: ${result.latest}`);
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('update.dialog.foundTitle'),
      message: t('update.dialog.foundMessage', { version: result.latest }),
      buttons: [t('update.dialog.openRelease'), t('update.dialog.cancel')],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) {
      shell.openExternal(result.releaseUrl);
    }
    showUpdateBanner(mainWindow, result.latest, result.releaseUrl);
  } else if (result.state === 'up_to_date') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('update.dialog.upToDate'),
      message: t('update.dialog.upToDateMessage', { version: app.getVersion() }),
      buttons: [t('update.dialog.ok')],
    });
  } else if (result.state === 'failed') {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: t('update.dialog.failed'),
      message: t('update.dialog.failedMessage'),
      buttons: [t('update.dialog.ok')],
    });
  } else if (result.state === 'skipped') {
    logger.info('Manual update check skipped: repository placeholder still in code.');
  }
}

function showUpdateBanner(mainWindow, latest, url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = t('update.found.banner', { version: latest });
  const safeMessage = JSON.stringify(message);
  const safeUrl = JSON.stringify(url);
  // Inject a fixed-position banner that does not interfere with the SillyTavern DOM.
  const script = `(() => {
    if (document.getElementById('__est_update_banner__')) return;
    const a = document.createElement('a');
    a.id = '__est_update_banner__';
    a.textContent = ${safeMessage};
    a.href = ${safeUrl};
    a.target = '_blank';
    a.rel = 'noopener';
    Object.assign(a.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      padding: '8px 16px', textAlign: 'center',
      background: '#2563eb', color: '#fff', fontFamily: 'system-ui, sans-serif',
      fontSize: '13px', zIndex: '2147483647', textDecoration: 'none', cursor: 'pointer'
    });
    a.addEventListener('click', (ev) => { ev.preventDefault(); window.open(a.href, '_blank'); });
    const close = document.createElement('span');
    close.textContent = '×';
    Object.assign(close.style, { position: 'absolute', right: '12px', top: '6px', fontSize: '18px', cursor: 'pointer' });
    close.addEventListener('click', (ev) => { ev.stopPropagation(); a.remove(); });
    a.appendChild(close);
    (document.body || document.documentElement).appendChild(a);
  })();`;
  mainWindow.webContents.executeJavaScript(script).catch(() => { /* ignore */ });
}

function showServiceCrashedBanner(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = JSON.stringify(t('service.crashed.banner'));
  const script = `(() => {
    if (document.getElementById('__est_crash_banner__')) return;
    const div = document.createElement('div');
    div.id = '__est_crash_banner__';
    div.textContent = ${message};
    Object.assign(div.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      padding: '12px 16px', textAlign: 'center',
      background: '#b91c1c', color: '#fff', fontFamily: 'system-ui, sans-serif',
      fontSize: '14px', fontWeight: '600', zIndex: '2147483647'
    });
    (document.body || document.documentElement).appendChild(div);
  })();`;
  mainWindow.webContents.executeJavaScript(script).catch(() => { /* ignore */ });
}

module.exports = {
  silentCheck,
  manualCheck,
  showServiceCrashedBanner,
  isPlaceholderRepo,
  releasesPageUrl,
};
