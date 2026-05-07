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
  moveDir(tmpClone, targetDir);
  writeStamp({
    version: stVersion,
    repository: stRepo,
    preparedAt: new Date().toISOString(),
  });
  console.log(`SillyTavern ${stVersion} prepared at ${targetDir}`);
}

main();
