
'use strict';

const { dialog, shell, BrowserWindow } = require('electron');
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
    url: item.getURL ? item.getURL() : item.url || '',
    filename: item.getFilename ? item.getFilename() : item.filename || 'download',
    totalBytes: 0,
    receivedBytes: 0,
    state: 'progressing',
    savePath: item.savePath || '',
    startedAt: Date.now(),
  };
  items.unshift(record);
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
    const dir = path.dirname(filePath);
    shell.showItemInFolder(filePath || dir);
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

function init() {
  const { session } = require('electron');
  session.defaultSession.on('will-download', async (event, webContents, item) => {
    event.preventDefault();
    let savePath;
    if (config.get().askWhereToSave) {
      const { canceled, filePath } = await dialog.showSaveDialog(
        winRef,
        { defaultPath: path.join(getDownloadDir(), item.getFilename()) }
      );
      if (canceled || !filePath) {
        item.cancel();
        return;
      }
      savePath = filePath;
    } else {
      savePath = path.join(getDownloadDir(), item.getFilename());
      // Ensure parent directory exists
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    item.savePath = savePath;
    const record = addItem(item);
    updateItem(record.id, { savePath, totalBytes: item.getTotalBytes() });
    broadcast('downloads:changed', getAll());

    item.on('updated', (e, state) => {
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
      }
    });
    item.once('done', (e, state) => {
      if (state === 'completed') {
        updateItem(record.id, { state: 'complete', receivedBytes: item.getTotalBytes() });
      } else if (state === 'cancelled') {
        updateItem(record.id, { state: 'cancelled' });
      } else {
        updateItem(record.id, { state: 'failed' });
      }
      broadcast('downloads:changed', getAll());
      // Persist
      config.update((d) => {
        d.downloads = items.map((i) => ({
          id: i.id, url: i.url, filename: i.filename,
          totalBytes: i.totalBytes, state: i.state,
          savePath: i.savePath, startedAt: i.startedAt,
        }));
      });
    });
  });
}

function broadcast(channel, data) {
  if (winRef && winRef.webContents && !winRef.webContents.isDestroyed()) {
    winRef.webContents.send(channel, data);
  }
}

module.exports = { init, getAll, removeItem, clearAll, openFolder, openFile, setWindow };
