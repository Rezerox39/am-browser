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
  // Safely extract properties from Electron DownloadItem
  try { record.url = item.getURL ? item.getURL() : (item.url || ''); } catch {}
  try { record.filename = item.getFilename ? item.getFilename() : (item.filename || 'download'); } catch {}
  try { record.mimeType = item.getMimeType ? item.getMimeType() : ''; } catch {}
  items.unshift(record);
  logger.info('downloads', `Added download: ${record.filename} from ${record.url}`);
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
  } catch (e) {
    logger.error('downloads', 'Failed to open folder', { error: e.message });
  }
}

function openFile(filePath) {
  try {
    shell.openPath(filePath);
  } catch (e) {
    logger.error('downloads', 'Failed to open file', { error: e.message });
  }
}

function getDownloadDir() {
  return path.join(app.getPath('home'), 'Downloads');
}

// Ensure unique filename — appends (1), (2), etc. if file exists
function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let n = 1;
  while (fs.existsSync(path.join(dir, base + ' (' + n + ')' + ext))) n++;
  return path.join(dir, base + ' (' + n + ')' + ext);
}

function init() {
  const { session } = require('electron');
  const ses = session.defaultSession;
  logger.info('downloads', 'init() called — attaching will-download to defaultSession');

  ses.on('will-download', async (event, webContents, item) => {
    logger.info('downloads', `will-download fired: ${item.getFilename()} from ${webContents.getURL()}`);

    try {
      // Compute default save path
      const defaultPath = path.join(getDownloadDir(), item.getFilename());
      const savePath = uniquePath(defaultPath);
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Create record IMMEDIATELY so the panel shows the download instantly
      const record = addItem(item);
      updateItem(record.id, { savePath, totalBytes: item.getTotalBytes() });
      broadcast('downloads:changed', getAll());

      // If "ask where to save" is enabled, show dialog (but record already exists)
      const { dialog } = require('electron');
      if (config.get().askWhereToSave) {
        try {
          const { canceled, filePath } = await dialog.showSaveDialog(winRef, { defaultPath: savePath });
          if (canceled || !filePath) {
            // User cancelled — remove the record and cancel the download
            removeItem(record.id);
            broadcast('downloads:changed', getAll());
            try { item.cancel(); } catch {}
            return;
          }
          // Update to user-chosen path
          const newPath = uniquePath(filePath);
          updateItem(record.id, { savePath: newPath });
          item.savePath = newPath;
        } catch (e) {
          logger.warn('downloads', 'Save dialog failed, using default path', { error: e.message });
        }
      } else {
        item.savePath = savePath;
      }

      logger.info('downloads', `Download started: ${record.filename} -> ${record.savePath}`);

      item.on('updated', (e, state) => {
        try {
          if (state === 'progressing') {
            updateItem(record.id, {
              receivedBytes: item.getReceivedBytes(),
              totalBytes: item.getTotalBytes(),
              state: 'progressing',
            });
            broadcast('downloads:changed', getAll());
          } else if (state === 'interrupted') {
            updateItem(record.id, { state: 'failed' });
            broadcast('downloads:changed', getAll());
            logger.warn('downloads', `Download interrupted: ${record.filename}`);
          }
        } catch (e) {
          logger.warn('downloads', 'Download update error', { error: e.message });
        }
      });

      item.once('done', (e, state) => {
        try {
          if (state === 'completed') {
            updateItem(record.id, { state: 'complete', receivedBytes: item.getTotalBytes() });
            logger.info('downloads', `Download complete: ${record.filename} (${item.getTotalBytes()} bytes)`);
          } else if (state === 'cancelled') {
            updateItem(record.id, { state: 'cancelled' });
            logger.info('downloads', `Download cancelled: ${record.filename}`);
          } else {
            updateItem(record.id, { state: 'failed' });
            logger.warn('downloads', `Download failed: ${record.filename} state=${state}`);
          }
          broadcast('downloads:changed', getAll());
          // Persist download history
          config.update((d) => {
            d.downloads = items.slice(0, 100).map((i) => ({
              id: i.id, url: i.url, filename: i.filename,
              totalBytes: i.totalBytes, state: i.state,
              savePath: i.savePath, startedAt: i.startedAt,
            }));
          });
        } catch (e) {
          logger.warn('downloads', 'Download done error', { error: e.message });
        }
      });
    } catch (e) {
      logger.error('downloads', 'will-download handler error', { error: e.message });
      // Try to cancel the download if setup fails
      try { item.cancel(); } catch {}
    }
  });

  logger.info('downloads', 'Download handler registered on defaultSession');
}

function broadcast(channel, data) {
  // Send to chrome window (triggers download bar notification)
  try {
    if (winRef && !winRef.isDestroyed() && winRef.webContents && !winRef.webContents.isDestroyed()) {
      winRef.webContents.send(channel, data);
    }
  } catch {}
  // Send to menu overlay view (triggers Downloads panel live update)
  try {
    const tabs = require('./tabs');
    const menuView = tabs.getMenuView();
    if (menuView && menuView.webContents && !menuView.webContents.isDestroyed()) {
      menuView.webContents.send(channel, data);
    }
  } catch {}
}

module.exports = { init, getAll, removeItem, clearAll, openFolder, openFile, setWindow };
