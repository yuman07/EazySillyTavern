#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

const stConfig = pkg.sillytavern || {};
const stVersion = stConfig.version;
const stRepo = stConfig.repository;

if (!stVersion || !stRepo) {
  console.error('package.json must declare sillytavern.version and sillytavern.repository');
  process.exit(1);
}

const targetDir = path.join(projectRoot, 'resources', 'sillytavern');
const tmpClone = path.join(projectRoot, 'resources', '.sillytavern-clone');
const stamp = path.join(targetDir, '.eazysillytavern.stamp');

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function readStamp() {
  if (!fs.existsSync(stamp)) return null;
  try { return JSON.parse(fs.readFileSync(stamp, 'utf8')); } catch { return null; }
}

function writeStamp(data) {
  fs.writeFileSync(stamp, JSON.stringify(data, null, 2));
}

function alreadyPrepared() {
  const existing = readStamp();
  if (!existing) return false;
  return existing.version === stVersion && existing.repository === stRepo;
}

function cloneSillyTavern() {
  rimraf(tmpClone);
  fs.mkdirSync(path.dirname(tmpClone), { recursive: true });
  run('git', ['clone', '--depth', '1', '--branch', stVersion, stRepo, tmpClone]);
}

function prune(dir) {
  const removeNames = ['.git', '.github', '.gitignore', '.dockerignore',
    'docs', 'tests', 'colab', 'docker', 'replit.nix', 'Dockerfile',
    'Update-Instructions.txt', 'UpdateAndStart.bat', 'UpdateForkAndStart.bat',
    'Remote-Link.cmd', 'Start.bat', 'start.sh', 'recover.js', 'CONTRIBUTING.md',
    'SECURITY.md', 'README.md'];
  for (const name of removeNames) {
    rimraf(path.join(dir, name));
  }
}

// Strip junk that lives inside individual node_modules packages and that the
// runtime never reads: package-level test/example/docs directories,
// .ts / .map / .markdown files everywhere, top-of-package metadata files.
//
// IMPORTANT: directory pruning is package-root-only — packages like `yaml`
// keep real runtime code under names like `dist/doc/`, so a recursive sweep
// breaks them. We only enter `node_modules/<pkg>/` (and `node_modules/@scope/<pkg>/`)
// and drop top-level dirs whose names match dropPkgRootDirs.
function pruneNodeModules(rootDir) {
  if (!fs.existsSync(rootDir)) return;
  const dropPkgRootDirs = new Set(['test', 'tests', '__tests__', 'example', 'examples', 'docs', '.github', '.vscode', '.idea', 'coverage']);
  // Files anywhere inside a package that are runtime-irrelevant.
  const dropExts = new Set(['.md', '.markdown', '.map', '.ts', '.tsx', '.flow']);
  // Top-of-package metadata files only — never recurse for these.
  const dropPkgRootFiles = new Set(['CHANGELOG', 'CHANGELOG.md', 'CHANGES', 'CHANGES.md',
    'HISTORY.md', 'AUTHORS', 'AUTHORS.md', 'CONTRIBUTORS', 'CONTRIBUTORS.md', '.npmignore',
    '.travis.yml', '.eslintrc', '.eslintrc.json', '.prettierrc', 'tsconfig.json',
    '.editorconfig', '.babelrc', 'jest.config.js', 'karma.conf.js']);

  function pruneInsidePackage(pkgDir) {
    let entries;
    try { entries = fs.readdirSync(pkgDir, { withFileTypes: true }); } catch { return; }
    // Pass 1: drop package-root dirs and meta files.
    for (const entry of entries) {
      const full = path.join(pkgDir, entry.name);
      if (entry.isDirectory() && dropPkgRootDirs.has(entry.name)) {
        rimraf(full);
      } else if (entry.isFile() && dropPkgRootFiles.has(entry.name)) {
        try { fs.unlinkSync(full); } catch { /* ignore */ }
      }
    }
    // Pass 2: recursively drop ext-matched files in remaining tree.
    function walkExts(current) {
      let walkEntries;
      try { walkEntries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
      for (const entry of walkEntries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walkExts(full);
        } else if (entry.isFile() && dropExts.has(path.extname(entry.name).toLowerCase())) {
          try { fs.unlinkSync(full); } catch { /* ignore */ }
        }
      }
    }
    walkExts(pkgDir);
  }

  function visitNodeModules(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        // Scoped namespace dir: each child is a package root.
        let scoped;
        try { scoped = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
        for (const child of scoped) {
          if (!child.isDirectory()) continue;
          const pkgDir = path.join(full, child.name);
          pruneInsidePackage(pkgDir);
          // Some packages have nested node_modules — recurse into those too.
          const nested = path.join(pkgDir, 'node_modules');
          if (fs.existsSync(nested)) visitNodeModules(nested);
        }
      } else {
        pruneInsidePackage(full);
        const nested = path.join(full, 'node_modules');
        if (fs.existsSync(nested)) visitNodeModules(nested);
      }
    }
  }
  visitNodeModules(rootDir);
}

function installProductionDeps(dir) {
  run('npm', ['install', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', '--no-progress'], { cwd: dir });
}

function moveDir(from, to) {
  rimraf(to);
  fs.renameSync(from, to);
}

function main() {
  if (alreadyPrepared() && process.argv[2] !== '--force') {
    console.log(`SillyTavern ${stVersion} already prepared at ${targetDir}. Use --force to reprepare.`);
    return;
  }
  console.log(`Preparing SillyTavern ${stVersion} from ${stRepo}`);
  cloneSillyTavern();
  prune(tmpClone);
  installProductionDeps(tmpClone);
  prune(tmpClone); // remove anything dev steps may have re-introduced
  console.log('Pruning node_modules (tests / docs / source maps / type defs)...');
  pruneNodeModules(path.join(tmpClone, 'node_modules'));
  moveDir(tmpClone, targetDir);
  writeStamp({
    version: stVersion,
    repository: stRepo,
    preparedAt: new Date().toISOString(),
  });
  console.log(`SillyTavern ${stVersion} prepared at ${targetDir}`);
}

main();
