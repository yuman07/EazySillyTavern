#!/usr/bin/env node
'use strict';

// Downloads the official Node 22 LTS binary for the current build host's platform/arch
// and places it at resources/node/node[.exe]. SPEC §四 requires bundling a real Node
// because Electron's BoringSSL lacks SHAKE algorithms that SillyTavern needs.

const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const nodeVersion = pkg.bundledNode?.version;
if (!nodeVersion) {
  console.error('package.json must declare bundledNode.version');
  process.exit(1);
}

const SUPPORTED = {
  'darwin-arm64': { archive: `node-v${nodeVersion}-darwin-arm64.tar.gz`, binPath: `node-v${nodeVersion}-darwin-arm64/bin/node`, outName: 'node' },
  'darwin-x64':   { archive: `node-v${nodeVersion}-darwin-x64.tar.gz`,   binPath: `node-v${nodeVersion}-darwin-x64/bin/node`,   outName: 'node' },
  'win32-x64':    { archive: `node-v${nodeVersion}-win-x64.zip`,         binPath: `node-v${nodeVersion}-win-x64/node.exe`,      outName: 'node.exe' },
  'linux-x64':    { archive: `node-v${nodeVersion}-linux-x64.tar.gz`,    binPath: `node-v${nodeVersion}-linux-x64/bin/node`,    outName: 'node' },
  'linux-arm64':  { archive: `node-v${nodeVersion}-linux-arm64.tar.gz`,  binPath: `node-v${nodeVersion}-linux-arm64/bin/node`,  outName: 'node' },
};

const platformKey = `${process.platform}-${process.arch}`;
const target = SUPPORTED[platformKey];
if (!target) {
  console.error(`Unsupported build host platform: ${platformKey}`);
  console.error('Run this on macOS arm64 or Windows x64. Linux is supported as a build host but not as a release target.');
  process.exit(1);
}

const baseUrl = `https://nodejs.org/dist/v${nodeVersion}/`;
const archiveUrl = baseUrl + target.archive;

const outDir = path.join(projectRoot, 'resources', 'node');
const outBin = path.join(outDir, target.outName);
const tmpDir = path.join(projectRoot, 'resources', '.node-tmp');
const tmpArchive = path.join(tmpDir, target.archive);
const stamp = path.join(outDir, '.eazysillytavern.stamp');

function readStamp() {
  if (!fs.existsSync(stamp)) return null;
  try { return JSON.parse(fs.readFileSync(stamp, 'utf8')); } catch { return null; }
}

function writeStamp(data) {
  fs.writeFileSync(stamp, JSON.stringify(data, null, 2));
}

function alreadyPrepared() {
  if (!fs.existsSync(outBin)) return false;
  const existing = readStamp();
  if (!existing) return false;
  return existing.version === nodeVersion && existing.platformKey === platformKey;
}

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function download(url, destFile) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destFile);
    function go(currentUrl) {
      https.get(currentUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return go(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`GET ${currentUrl} → ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    }
    go(url);
  });
}

function extractBinary() {
  // Use system `tar`: macOS, modern Linux, and Windows 10 1803+ all ship one that handles .tar.gz and .zip.
  console.log(`> tar -xf ${tmpArchive} -C ${tmpDir} ${target.binPath}`);
  execFileSync('tar', ['-xf', tmpArchive, '-C', tmpDir, target.binPath], { stdio: 'inherit' });
  fs.mkdirSync(outDir, { recursive: true });
  const extractedPath = path.join(tmpDir, target.binPath);
  fs.copyFileSync(extractedPath, outBin);
  if (process.platform !== 'win32') {
    fs.chmodSync(outBin, 0o755);
  }
}

async function main() {
  if (alreadyPrepared() && process.argv[2] !== '--force') {
    console.log(`Bundled Node ${nodeVersion} (${platformKey}) already at ${outBin}. Use --force to refetch.`);
    return;
  }
  console.log(`Fetching Node ${nodeVersion} for ${platformKey}: ${archiveUrl}`);
  rimraf(tmpDir);
  rimraf(outDir);
  fs.mkdirSync(tmpDir, { recursive: true });
  await download(archiveUrl, tmpArchive);
  extractBinary();
  writeStamp({
    version: nodeVersion,
    platformKey,
    preparedAt: new Date().toISOString(),
    sourceUrl: archiveUrl,
  });
  rimraf(tmpDir);
  console.log(`Bundled Node ${nodeVersion} ready at ${outBin}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
