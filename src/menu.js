'use strict';

const { app, Menu, shell, dialog, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { t } = require('./i18n');
const { manualCheck } = require('./updater');

function readSillyTavernVersion() {
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.sillytavern?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function showAboutDialog(parentWindow) {
  const stVersion = readSillyTavernVersion();
  const lines = [
    `${t('about.appVersion')}: ${app.getVersion()}`,
    `${t('about.sillyTavernVersion')}: ${stVersion}`,
    `${t('about.repository')}: https://github.com/yuman07/EazySillyTavern`,
    `${t('about.license')}: AGPL-3.0`,
  ];
  dialog.showMessageBox(parentWindow ?? undefined, {
    type: 'info',
    title: t('about.title'),
    message: 'EazySillyTavern',
    detail: lines.join('\n'),
    buttons: [t('about.ok')],
  });
}

function buildMenu({ logger, paths, getMainWindow }) {
  const isMac = process.platform === 'darwin';

  const fileMenu = {
    label: t('menu.file'),
    submenu: [
      {
        label: t('menu.file.openDataDir'),
        click: () => { shell.openPath(paths.data).catch((e) => logger.error(`openPath data: ${e}`)); },
      },
      {
        label: t('menu.file.openLogsDir'),
        click: () => { shell.openPath(paths.logs).catch((e) => logger.error(`openPath logs: ${e}`)); },
      },
      { type: 'separator' },
      {
        label: t('menu.file.checkUpdate'),
        click: () => { manualCheck(logger, getMainWindow()); },
      },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: t('menu.app.quit') }]),
    ],
  };

  const editMenu = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.edit.undo') },
      { role: 'redo', label: t('menu.edit.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'selectAll', label: t('menu.edit.selectAll') },
    ],
  };

  const viewMenu = {
    label: t('menu.view'),
    submenu: [
      { role: 'reload', label: t('menu.view.reload') },
      { role: 'toggleDevTools', label: t('menu.view.toggleDevTools') },
      { type: 'separator' },
      { role: 'resetZoom', label: t('menu.view.resetZoom') },
      { role: 'zoomIn', label: t('menu.view.zoomIn') },
      { role: 'zoomOut', label: t('menu.view.zoomOut') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('menu.view.fullScreen') },
    ],
  };

  const windowMenu = {
    label: t('menu.window'),
    submenu: [
      { role: 'minimize', label: t('menu.window.minimize') },
      { role: 'close', label: t('menu.window.close') },
    ],
  };

  const template = [];
  if (isMac) {
    template.push({
      label: app.getName(),
      submenu: [
        { label: t('menu.app.about'), click: () => showAboutDialog(getMainWindow()) },
        { type: 'separator' },
        { role: 'services', label: t('menu.app.services') },
        { type: 'separator' },
        { role: 'hide', label: t('menu.app.hide') },
        { role: 'hideOthers', label: t('menu.app.hideOthers') },
        { role: 'unhide', label: t('menu.app.showAll') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.app.quit') },
      ],
    });
  }
  template.push(fileMenu, editMenu, viewMenu, windowMenu);
  if (!isMac) {
    template.push({
      label: '?',
      submenu: [{ label: t('menu.app.about'), click: () => showAboutDialog(getMainWindow()) }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
