'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

let cached = null;

function resolveUserDataRoot() {
  return app.getPath('userData');
}

function getPaths() {
  if (cached) return cached;

  const root = resolveUserDataRoot();
  cached = {
    root,
    data: path.join(root, 'data'),
    logs: path.join(root, 'logs'),
    config: path.join(root, 'config'),
    sillyTavernConfig: path.join(root, 'data', 'config.yaml'),
  };

  for (const dir of [cached.root, cached.data, cached.logs, cached.config]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return cached;
}

function getSillyTavernResourcePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'sillytavern');
  }
  return path.join(app.getAppPath(), 'resources', 'sillytavern');
}

function getBundledNodePath() {
  const binName = process.platform === 'win32' ? 'node.exe' : 'node';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'node', binName);
  }
  return path.join(app.getAppPath(), 'resources', 'node', binName);
}

module.exports = { getPaths, getSillyTavernResourcePath, getBundledNodePath };
