'use strict';

const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');
const { app } = require('electron');

let items = [];
let winRef = null;

function setWindow(w) { winRef = w; }

function getAll() { return items; }

// Sanitize filename for Windows — remove illegal chars, fallback if empty
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  // Remove characters illegal on Windows
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ');
  // Limit length (Windows MAX_PATH)
  if (clean.length > 200) clean = clean.slice(0, 200);
  return clean;
}

function addItem(item) {
  const record = {
    id: 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    url: '',
    filename: 'download',
    totalBytes: 0,
    receivedBytes: 0,
    state: 'progressing',
    savePath: '',
    startedAt: Date.now(),
    mimeType: '',
  };
  try {
    const rawUrl = item.getURL ? item.getURL() : '';
    record.url = typeof rawUrl === 'string' ? rawUrl : '';
  } catch {}
  try {
    const rawName = item.getFilename ? item.getFilename() : '';
    record.filename = sanitizeFilename(rawName) || 'download';
  } catch {}
  try {
    const rawMime = item.getMimeType ? item.getMimeType() : '';
    record.mimeType = typeof rawMime === 'string' ? rawMime : '';
  } catch {}
  items.unshift(record);
  try { logger.info('downloads', 'Added download: ' + record.filename + ' from ' + record.url); } catch {}
  return record;
}

function updateItem(id, update) {
  const item = items.find((i) => i.id === id);
  if (item) Object.assign(item, update);
}

function removeItem(id) {
  items = items.filter((i) => i.id !== id);
}

function clearAll() {
  items = [];
}

function openFolder(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else {
      shell.showItemInFolder(getDownloadDir());
    }
  } catch {}
}

function openFile(filePath) {
  try {
    shell.openPath(filePath);
  } catch {}
}

function getDownloadDir() {
  try {
    const dir = path.join(app.getPath('home'), 'Downloads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return app.getPath('home');
  }
}

function uniquePath(filePath) {
  try {
    if (!fs.existsSync(filePath)) return filePath;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    let n = 1;
    while (fs.existsSync(path.join(dir, base + ' (' + n + ')' + ext))) n++;
    return path.join(dir, base + ' (' + n + ')' + ext);
  } catch {
    return filePath + '-' + Date.now();
  }
}

function init() {
  const { session } = require('electron');
  const ses = session.defaultSession;

  ses.on('will-download', (event, webContents, item) => {
    // EVERYTHING inside one try — nothing must escape to trigger app.quit()
    try {
      // Safely get filename with fallback
      let rawName = '';
      try { rawName = item.getFilename(); } catch {}
      const filename = sanitizeFilename(rawName) || ('download-' + Date.now());

      let rawUrl = '';
      try { rawUrl = webContents.getURL(); } catch {}

      logger.info('downloads', 'will-download: ' + filename + ' from ' + rawUrl);

      // Ensure Downloads directory exists
      const dir = getDownloadDir();

      // Build safe save path
      const savePath = uniquePath(path.join(dir, filename));
      const saveDir = path.dirname(savePath);
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

      // Set save path on the DownloadItem
      item.savePath = savePath;

      // Create record IMMEDIATELY so the panel shows it
      const record = addItem(item);
      updateItem(record.id, { savePath: savePath });
      try {
        const totalBytes = item.getTotalBytes ? item.getTotalBytes() : 0;
        updateItem(record.id, { totalBytes: typeof totalBytes === 'number' ? totalBytes : 0 });
      } catch {}
      broadcast('downloads:changed', getAll());

      // Progress updates
      try {
        item.on('updated', (e, state) => {
          try {
            if (state === 'progressing') {
              let received = 0, total = 0;
              try { received = item.getReceivedBytes(); } catch {}
              try { total = item.getTotalBytes(); } catch {}
              updateItem(record.id, {
                receivedBytes: typeof received === 'number' ? received : 0,
                totalBytes: typeof total === 'number' ? total : 0,
                state: 'progressing',
              });
              broadcast('downloads:changed', getAll());
            } else if (state === 'interrupted') {
              updateItem(record.id, { state: 'failed' });
              broadcast('downloads:changed', getAll());
            }
          } catch {}
        });
      } catch {}

      // Completion
      try {
        item.once('done', (e, state) => {
          try {
            if (state === 'completed') {
              let total = 0;
              try { total = item.getTotalBytes(); } catch {}
              updateItem(record.id, {
                state: 'complete',
                receivedBytes: typeof total === 'number' ? total : 0,
                totalBytes: typeof total === 'number' ? total : 0,
              });
            } else if (state === 'cancelled') {
              updateItem(record.id, { state: 'cancelled' });
            } else {
              updateItem(record.id, { state: 'failed' });
            }
            broadcast('downloads:changed', getAll());
            config.update((d) => {
              d.downloads = items.slice(0, 100).map((i) => ({
                id: i.id, url: i.url, filename: i.filename,
                totalBytes: i.totalBytes, state: i.state,
                savePath: i.savePath, startedAt: i.startedAt,
              }));
            });
          } catch {}
        });
      } catch {}

    } catch (e) {
      // Last resort — cancel the download so Electron doesn't hang
      try { item.cancel(); } catch {}
      try { logger.error('downloads', 'will-download error: ' + (e && e.message)); } catch {}
      try { console.error('[downloads] will-download error:', e); } catch {}
    }
  });
}

function broadcast(channel, data) {
  try {
    if (winRef && !winRef.isDestroyed() && winRef.webContents && !winRef.webContents.isDestroyed()) {
      winRef.webContents.send(channel, data);
    }
  } catch {}
  try {
    const tabs = require('./tabs');
    const menuView = tabs.getMenuView();
    if (menuView && menuView.webContents && !menuView.webContents.isDestroyed()) {
      menuView.webContents.send(channel, data);
    }
  } catch {}
}

module.exports = { init, getAll, removeItem, clearAll, openFolder, openFile, setWindow, sanitizeFilename };
