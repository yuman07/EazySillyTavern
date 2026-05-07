#!/usr/bin/env node
'use strict';

// Packages dist/mac-arm64/EazySillyTavern.app into a single-file .dmg using
// hdiutil directly. Used as a fallback when electron-builder's dmgbuild step
// fails on hdiutil "resource busy" — a known race between dmgbuild's detach
// and macOS DiskArbitration / Spotlight on some hosts.
//
// The output dmg has the same UX promise as electron-builder's: drag the
// included .app to /Applications. We add an Applications symlink so the user
// can do this without leaving the dmg window.
//
// Usage:
//   node scripts/pack-mac-dmg.js          # uses dist/mac-arm64/EazySillyTavern.app
//   node scripts/pack-mac-dmg.js <path>   # uses a custom .app path

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  console.error('pack-mac-dmg.js: macOS only.');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const productName = pkg.productName || pkg.name;

const appPath = path.resolve(process.argv[2] || path.join(projectRoot, 'dist', 'mac-arm64', `${productName}.app`));
if (!fs.existsSync(appPath)) {
  console.error(`App bundle not found: ${appPath}`);
  console.error('Run `npm run build:mac` first (the .app is produced even when dmg fails).');
  process.exit(1);
}

const distDir = path.join(projectRoot, 'dist');
const stagingDir = path.join(distDir, '.dmg-staging');
const outputDmg = path.join(distDir, `${productName}-${version}-mac-arm64.dmg`);
const tempDmg = path.join(distDir, `${productName}-${version}-mac-arm64.tmp.dmg`);

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

// Stage: a directory containing the .app + a symlink to /Applications.
console.log(`Staging dmg layout in ${stagingDir}…`);
rimraf(stagingDir);
fs.mkdirSync(stagingDir, { recursive: true });
run('cp', ['-R', appPath, stagingDir]);
fs.symlinkSync('/Applications', path.join(stagingDir, 'Applications'));

// Step 1: create a writable UDRW dmg from the staging dir.
rimraf(tempDmg);
rimraf(outputDmg);
run('hdiutil', [
  'create',
  '-srcfolder', stagingDir,
  '-volname', productName,
  '-fs', 'HFS+',
  '-format', 'UDRW',
  '-ov',
  tempDmg,
]);

// Step 2: convert to read-only ULFO (LZFSE compressed) — final shippable dmg.
run('hdiutil', [
  'convert',
  tempDmg,
  '-format', 'ULFO',
  '-o', outputDmg,
]);

rimraf(tempDmg);
rimraf(stagingDir);

const stat = fs.statSync(outputDmg);
console.log(`\nWrote ${outputDmg}`);
console.log(`Size: ${(stat.size / (1024 * 1024)).toFixed(1)} MB`);
