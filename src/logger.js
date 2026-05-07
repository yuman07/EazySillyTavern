'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 20;

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function rollOldLogs(logsDir) {
  let entries;
  try {
    entries = fs.readdirSync(logsDir)
      .filter((f) => f.startsWith('startup-') && f.endsWith('.log'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return;
  }
  for (const old of entries.slice(MAX_FILES - 1)) {
    try { fs.unlinkSync(path.join(logsDir, old.name)); } catch { /* ignore */ }
  }
}

class Logger {
  constructor(logsDir) {
    this.logsDir = logsDir;
    fs.mkdirSync(logsDir, { recursive: true });
    rollOldLogs(logsDir);
    this.filePath = path.join(logsDir, `startup-${timestampForFilename()}.log`);
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
  }

  _write(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    this.stream.write(line);
    if (level === 'ERROR') process.stderr.write(line);
    else process.stdout.write(line);
  }

  info(msg) { this._write('INFO', msg); }
  warn(msg) { this._write('WARN', msg); }
  error(msg) { this._write('ERROR', msg); }

  pipeChild(child) {
    if (child.stdout) child.stdout.on('data', (b) => this.stream.write(b));
    if (child.stderr) child.stderr.on('data', (b) => this.stream.write(b));
  }

  close() {
    try { this.stream.end(); } catch { /* ignore */ }
  }
}

module.exports = { Logger };
