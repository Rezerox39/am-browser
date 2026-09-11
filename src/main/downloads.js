'use strict';

const { shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

let items = [];
let winRef = null;

function setWindow(w) { winRef = w; }
function getAll() { return items; }

/* ── Filename sanitization ─────────────────────────────────── */
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  clean = clean.replace(/\s+/g, ' ');
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
  try { const u = item.getURL ? item.getURL() : ''; record.url = typeof u === 'string' ? u : ''; } catch {}
  try { const n = item.getFilename ? item.getFilename() : ''; record.filename = sanitizeFilename(n) || 'download'; } catch {}
  try { const m = item.getMimeType ? item.getMimeType() : ''; record.mimeType = typeof m === 'string' ? m : ''; } catch {}
  items.unshift(record);
  try { logger.info('downloads', 'Added: ' + record.filename); } catch {}
  return record;
}

function updateItem(id, update) {
  const item = items.find((i) => i.id === id);
  if (item) Object.assign(item, update);
}

function removeItem(id) {
  items = items.filter((i) => i.id !== id);
}

function clearAll() { items = []; }

function openFolder(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    else shell.showItemInFolder(getDownloadDir());
  } catch {}
}

function openFile(filePath) {
  try { shell.openPath(filePath); } catch {}
}

function getDownloadDir() {
  try {
    const dir = path.join(app.getPath('home'), 'Downloads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch { return app.getPath('home'); }
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
  } catch { return filePath + '-' + Date.now(); }
}

/* ── Type classification ───────────────────────────────────── */
function classifyType(mimeType, filename) {
  const m = (mimeType || '').toLowerCase();
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (m.includes('image') || ['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext)) return 'image';
  if (m.includes('video') || ['mp4','webm','mkv','avi','mov','flv'].includes(ext)) return 'video';
  if (m.includes('audio') || ['mp3','wav','ogg','flac','aac','m4a'].includes(ext)) return 'audio';
  if (m.includes('pdf') || ext === 'pdf') return 'pdf';
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return 'archive';
  if (['exe','msi','app','dmg'].includes(ext)) return 'executable';
  if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) return 'document';
  return 'file';
}

/* ── Safe broadcast — individual try-catch per target ──────── */
function broadcast(channel, data) {
  try {
    if (winRef && !winRef.isDestroyed() && winRef.webContents && !winRef.webContents.isDestroyed()) {
      try { winRef.webContents.send(channel, data); } catch {}
    }
  } catch {}
  try {
    const tabs = require('./tabs');
    const menuView = tabs.getMenuView();
    if (menuView && menuView.webContents && !menuView.webContents.isDestroyed()) {
      try { menuView.webContents.send(channel, data); } catch {}
    }
  } catch {}
}

/* ── Persistent config save ─────────────────────────────────── */
function persistToConfig() {
  try {
    config.update((d) => {
      d.downloads = items.slice(0, 100).map((i) => ({
        id: i.id, url: i.url, filename: i.filename,
        totalBytes: i.totalBytes, state: i.state,
        savePath: i.savePath, startedAt: i.startedAt,
      }));
    });
  } catch (e) {
    try { logger.error('downloads', 'Config save failed', { error: e.message }); } catch {}
  }
}

/* ── Init: register will-download on the session ──────────── */
function init() {
  const { session } = require('electron');
  const ses = session.defaultSession;

  ses.on('will-download', (event, webContents, item) => {
    try {
      // Step 1: Determine filename
      let rawName = '';
      try { rawName = item.getFilename(); } catch {}
      const filename = sanitizeFilename(rawName) || ('download-' + Date.now());

      let rawUrl = '';
      try { rawUrl = webContents.getURL(); } catch {}
      try { logger.info('downloads', 'will-download: ' + filename); } catch {}

      // Step 2: Ensure Downloads directory exists
      const dir = getDownloadDir();

      // Step 3: Build safe save path and set it on the DownloadItem
      const savePath = uniquePath(path.join(dir, filename));
      try {
        const saveDir = path.dirname(savePath);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      } catch {}

      try { item.savePath = savePath; } catch (e) {
        try { logger.error('downloads', 'Failed to set savePath', { error: e.message }); } catch {}
      }

      // Step 4: Create record IMMEDIATELY so the panel shows it
      const record = addItem(item);
      try { updateItem(record.id, { savePath: savePath }); } catch {}
      try {
        const totalBytes = item.getTotalBytes ? item.getTotalBytes() : 0;
        updateItem(record.id, { totalBytes: typeof totalBytes === 'number' ? totalBytes : 0 });
      } catch {}
      try { updateItem(record.id, { type: classifyType(record.mimeType, record.filename) }); } catch {}

      // Broadcast initial state
      try { broadcast('downloads:changed', getAll()); } catch {}

      // Step 5: Progress updates
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
              try { broadcast('downloads:changed', getAll()); } catch {}
            } else if (state === 'interrupted') {
              updateItem(record.id, { state: 'failed' });
              try { broadcast('downloads:changed', getAll()); } catch {}
            }
          } catch {}
        });
      } catch {}

      // Step 6: Completion
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
            try { broadcast('downloads:changed', getAll()); } catch {}
            persistToConfig();
          } catch {}
        });
      } catch {}

    } catch (e) {
      // Last resort — cancel the download so Electron doesn't hang
      try { item.cancel(); } catch {}
      try { logger.error('downloads', 'will-download error', { error: e.message }); } catch {}
      try { console.error('[downloads] will-download error:', e); } catch {}
    }
  });

  logger.info('downloads', 'Download handler registered on defaultSession');
}

module.exports = { init, getAll, removeItem, clearAll, openFolder, openFile, setWindow, sanitizeFilename, classifyType };
