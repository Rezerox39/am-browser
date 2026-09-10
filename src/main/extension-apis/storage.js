'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../logger');

const STORAGE_DIR = path.join(app.getPath('userData'), 'extension-storage');
// In-memory cache: "extensionId:area" -> data object
const cache = new Map();

function ensureDir() {
  try { fs.mkdirSync(STORAGE_DIR, { recursive: true }); } catch {}
}

function filePath(extensionId, area) {
  ensureDir();
  return path.join(STORAGE_DIR, `${extensionId}_${area}.json`);
}

function loadFromDisk(extensionId, area) {
  try {
    const p = filePath(extensionId, area);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return {};
}

function saveToDisk(extensionId, area, data) {
  try {
    fs.writeFileSync(filePath(extensionId, area), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.warn('extension-storage', 'Save failed', { extensionId, area, error: e.message });
  }
}

function getStore(extensionId, area) {
  const key = `${extensionId}:${area}`;
  if (!cache.has(key)) {
    cache.set(key, loadFromDisk(extensionId, area));
  }
  return cache.get(key);
}

function persist(extensionId, area) {
  const key = `${extensionId}:${area}`;
  if (cache.has(key)) {
    saveToDisk(extensionId, area, cache.get(key));
  }
}

function normalizeKeys(keys) {
  if (keys == null) return null;
  if (typeof keys === 'string') return [keys];
  if (Array.isArray(keys)) return keys;
  if (typeof keys === 'object') return Object.keys(keys);
  throw new Error('Invalid storage keys');
}

function get({ context, args }) {
  const [area, keys] = args;
  const store = getStore(context.extensionId, area);

  if (keys == null) return { ...store };

  const result = {};
  if (typeof keys === 'object' && !Array.isArray(keys)) {
    for (const key of Object.keys(keys)) {
      result[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : keys[key];
    }
    return result;
  }

  for (const key of normalizeKeys(keys)) {
    if (Object.prototype.hasOwnProperty.call(store, key)) {
      result[key] = store[key];
    }
  }
  return result;
}

function set({ context, args }) {
  const [area, items] = args;
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    throw new Error('storage.set requires an object');
  }
  const store = getStore(context.extensionId, area);
  for (const [key, value] of Object.entries(items)) {
    store[key] = value;
  }
  persist(context.extensionId, area);
  return undefined;
}

function remove({ context, args }) {
  const [area, keys] = args;
  const store = getStore(context.extensionId, area);
  for (const key of normalizeKeys(keys)) {
    delete store[key];
  }
  persist(context.extensionId, area);
  return undefined;
}

function clear({ context, args }) {
  const [area] = args;
  const store = getStore(context.extensionId, area);
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  persist(context.extensionId, area);
  return undefined;
}

function getBytesInUse({ context, args }) {
  const [area, keys] = args;
  const result = get({ context, args: [area, keys] });
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

function destroyExtension(extensionId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${extensionId}:`)) {
      cache.delete(key);
    }
  }
}

module.exports = { get, set, remove, clear, getBytesInUse, destroyExtension };
