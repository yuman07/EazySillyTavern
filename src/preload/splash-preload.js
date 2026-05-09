'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eazyApi', {
  requestStrings: () => ipcRenderer.send('splash:request-strings'),
  onStrings: (cb) => ipcRenderer.on('splash:strings', (_e, strings) => cb(strings)),
  onStatus: (cb) => ipcRenderer.on('splash:status', (_e, msg) => cb(msg)),
  onHint: (cb) => ipcRenderer.on('splash:hint', (_e, msg) => cb(msg)),
  onError: (cb) => ipcRenderer.on('splash:error', (_e, msg) => cb(msg)),
  viewLog: () => ipcRenderer.send('splash:view-log'),
  quit: () => ipcRenderer.send('splash:quit'),
});
