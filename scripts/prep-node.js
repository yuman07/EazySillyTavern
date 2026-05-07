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

// Allow overriding the target platform from the CLI for cross-compile builds.
// Examples:
//   node scripts/prep-node.js --target=win32-x64
//   EAZY_TARGET=darwin-arm64 node scripts/prep-node.js
const cliTarget = (() => {
  const arg = process.argv.find((a) => a.startsWith('--target='));
  if (arg) return arg.slice('--target='.length);
  return process.env.EAZY_TARGET;
})();
const platformKey = cliTarget || `${process.platform}-${process.arch}`;
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

// Force flag: --force or as the last positional CLI arg (preserves the prior
// behaviour of `node prep-node.js --force` while also supporting --force= as
// a peer of --target=).
function shouldForce() {
  return process.argv.includes('--force');
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
  // tar.gz → tar (any tar implementation)
  // .zip → unzip (GNU tar can't read zip; bsdtar can but isn't always on PATH)
  if (target.archive.endsWith('.tar.gz') || target.archive.endsWith('.tar.xz')) {
    console.log(`> tar -xf ${tmpArchive} -C ${tmpDir} ${target.binPath}`);
    execFileSync('tar', ['-xf', tmpArchive, '-C', tmpDir, target.binPath], { stdio: 'inherit' });
  } else if (target.archive.endsWith('.zip')) {
    console.log(`> unzip -o -q ${tmpArchive} ${target.binPath} -d ${tmpDir}`);
    execFileSync('unzip', ['-o', '-q', tmpArchive, target.binPath, '-d', tmpDir], { stdio: 'inherit' });
  } else {
    throw new Error(`Unsupported archive format: ${target.archive}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const extractedPath = path.join(tmpDir, target.binPath);
  fs.copyFileSync(extractedPath, outBin);
  if (process.platform !== 'win32') {
    fs.chmodSync(outBin, 0o755);
  }
}

async function main() {
  if (alreadyPrepared() && !shouldForce()) {
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
