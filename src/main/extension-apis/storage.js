'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../logger');

const STORAGE_DIR = path.join(app.getPath('userData'), 'extension-storage');

function ensureDir() {
  try { fs.mkdirSync(STORAGE_DIR, { recursive: true }); } catch {}
}

function filePath(extensionId, area) {
  ensureDir();
  return path.join(STORAGE_DIR, `${extensionId}_${area}.json`);
}

function loadSync(extensionId, area) {
  try {
    const p = filePath(extensionId, area);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return {};
}

function saveSync(extensionId, area, data) {
  try {
    fs.writeFileSync(filePath(extensionId, area), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.warn('extension-storage', 'Save failed', { extensionId, area, error: e.message });
  }
}

function getStorageData(extensionId, area) {
  return loadSync(extensionId, area);
}

// chrome.storage.local / chrome.storage.sync
function handleStorageGet(extensionId, area, keys) {
  const data = loadSync(extensionId, area);
  if (keys === null || keys === undefined) return data;
  if (typeof keys === 'string') keys = [keys];
  if (Array.isArray(keys)) {
    const result = {};
    for (const k of keys) { if (k in data) result[k] = data[k]; }
    return result;
  }
  if (typeof keys === 'object') {
    const result = {};
    for (const [k, defaultValue] of Object.entries(keys)) {
      result[k] = k in data ? data[k] : defaultValue;
    }
    return result;
  }
  return data;
}

function handleStorageSet(extensionId, area, items) {
  if (!items || typeof items !== 'object') return;
  const data = loadSync(extensionId, area);
  Object.assign(data, items);
  saveSync(extensionId, area, data);
}

function handleStorageRemove(extensionId, area, keys) {
  if (!keys) return;
  if (typeof keys === 'string') keys = [keys];
  if (!Array.isArray(keys)) return;
  const data = loadSync(extensionId, area);
  for (const k of keys) delete data[k];
  saveSync(extensionId, area, data);
}

function handleStorageClear(extensionId, area) {
  saveSync(extensionId, area, {});
}

function handleStorageGetBytesInUse(extensionId, area, keys) {
  const data = loadSync(extensionId, area);
  const str = JSON.stringify(data);
  return Buffer.byteLength(str, 'utf8');
}

module.exports = {
  handleStorageGet,
  handleStorageSet,
  handleStorageRemove,
  handleStorageClear,
  handleStorageGetBytesInUse,
};
