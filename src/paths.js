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
  const config = path.join(root, 'config');
  cached = {
    root,
    data: path.join(root, 'data'),
    logs: path.join(root, 'logs'),
    config,
    sillyTavernConfig: path.join(root, 'data', 'config.yaml'),
    // Runtime-only persistent cache for the bundled Node's V8 bytecode (NODE_COMPILE_CACHE).
    // Hidden subdirectory under config/ to stay within SPEC §八's directory layout while
    // signalling "implementation detail, safe to delete". SillyTavern's startup require()
    // graph is hundreds of modules; warm runs reuse the cached bytecode and skip parse+compile.
    nodeCompileCache: path.join(config, '.node-compile-cache'),
  };

  for (const dir of [cached.root, cached.data, cached.logs, cached.config, cached.nodeCompileCache]) {
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
