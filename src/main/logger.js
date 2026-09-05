
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'am.log');
const MAX_SIZE = 1024 * 1024; // 1 MB

let fd = null;

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotate() {
  try {
    if (fd) { fd.close(); fd = null; }
    if (fs.existsSync(LOG_FILE)) {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > MAX_SIZE) {
        const backup = LOG_FILE + '.1';
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(LOG_FILE, backup);
      }
    }
  } catch { /* best effort */ }
}

function log(level, component, message, extra) {
  try {
    ensureDir();
    if (!fd || !fs.existsSync(LOG_FILE)) {
      rotate();
      fd = fs.openSync(LOG_FILE, 'a');
    }
    const ts = new Date().toISOString();
    const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
    const line = ts + ' [' + level.toUpperCase() + '] [' + component + '] ' + message + extraStr + '
';
    fs.writeSync(fd, line);
  } catch { /* silent */ }
}

module.exports = {
  info: (c, m, e) => log('info', c, m, e),
  warn: (c, m, e) => log('warn', c, m, e),
  error: (c, m, e) => log('error', c, m, e),
  debug: (c, m, e) => log('debug', c, m, e),
};
