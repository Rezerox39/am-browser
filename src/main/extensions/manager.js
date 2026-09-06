'use strict';

const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const logger = require('../logger');
const registry = require('./registry');

const EXTENSIONS_DIR = path.join(app.getPath('userData'), 'extensions', 'installed');

let ses = null;
let enabledExtensions = new Map();

// Per-extension error store (limited history)
const MAX_ERRORS = 50;
const extensionErrors = new Map(); // id -> { errors: [], warnings: [], lastError }

function addError(id, message) {
  if (!extensionErrors.has(id)) extensionErrors.set(id, { errors: [], warnings: [], lastError: null });
  const store = extensionErrors.get(id);
  store.errors.push({ time: Date.now(), message });
  if (store.errors.length > MAX_ERRORS) store.errors.shift();
  store.lastError = message;
}

function addWarning(id, message) {
  if (!extensionErrors.has(id)) extensionErrors.set(id, { errors: [], warnings: [], lastError: null });
  const store = extensionErrors.get(id);
  store.warnings.push({ time: Date.now(), message });
  if (store.warnings.length > MAX_ERRORS) store.warnings.shift();
}

function clearErrors(id) {
  extensionErrors.delete(id);
}

function init() {
  ses = session.defaultSession;
  registry.load();
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }
  logger.info('extensions', 'Extension manager initialized');
}

function generateExtensionId(dir) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(path.resolve(dir)).digest('hex').substring(0, 32);
}

async function installFromDir(sourceDir) {
  const manifestPath = path.join(sourceDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('No manifest.json found in extension directory');

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { throw new Error('Invalid manifest.json: ' + e.message); }

  if (!manifest.name) throw new Error('manifest.json missing "name"');
  if (!manifest.version) throw new Error('manifest.json missing "version"');
  if (!manifest.manifest_version) throw new Error('manifest.json missing "manifest_version"');
  const mv = manifest.manifest_version;
  if (mv !== 2 && mv !== 3) throw new Error('Unsupported manifest_version: ' + mv);

  const destDir = path.join(EXTENSIONS_DIR, generateExtensionId(sourceDir));

  // Copy extension into managed storage
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, destDir, { recursive: true });

  let electronExt;
  try {
    electronExt = await ses.loadExtension(destDir, { allowFileAccess: false });
  } catch (e) {
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
    throw new Error('Electron failed to load extension: ' + e.message);
  }

  // Use Electron's own extension ID (not our hash)
  const realId = electronExt.id;

  registry.register({
    id: realId,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    enabled: true,
    path: destDir,
    manifestVersion: mv,
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
    icon: manifest.icons ? (manifest.icons['48'] || manifest.icons['16'] || null) : null,
  });

  enabledExtensions.set(realId, electronExt);
  logger.info('extensions', 'Extension installed', { id: realId, name: manifest.name, version: manifest.version });
  return realId;
}

async function uninstall(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);
  try { ses.removeExtension(id); } catch (e) { logger.warn('extensions', 'removeExtension failed', { error: e.message }); }
  try { if (ext.path && fs.existsSync(ext.path)) fs.rmSync(ext.path, { recursive: true, force: true }); } catch {}
  registry.unregister(id);
  enabledExtensions.delete(id);
  clearErrors(id);
  logger.info('extensions', 'Extension uninstalled', { id });
}

async function enable(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);
  if (ext.enabled) return;
  try {
    const electronExt = await ses.loadExtension(ext.path, { allowFileAccess: false });
    enabledExtensions.set(id, electronExt);
    registry.setEnabled(id, true);
    logger.info('extensions', 'Extension enabled', { id, name: ext.name });
  } catch (e) {
    addError(id, 'Failed to enable: ' + e.message);
    throw new Error('Failed to enable extension: ' + e.message);
  }
}

async function disable(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);
  if (!ext.enabled) return;
  try { ses.removeExtension(id); } catch (e) { logger.warn('extensions', 'removeExtension failed', { error: e.message }); }
  registry.setEnabled(id, false);
  enabledExtensions.delete(id);
  logger.info('extensions', 'Extension disabled', { id, name: ext.name });
}

async function reload(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);
  if (ext.enabled) { await disable(id); await enable(id); }
}

function getExtensionInfo(id) {
  const ext = registry.get(id);
  if (!ext) return null;
  let electronExt = null;
  try { electronExt = ses.getExtension(id); } catch {}
  return { ...ext, loaded: !!electronExt, electronName: electronExt?.manifest?.name || ext.name, manifest: electronExt?.manifest || null };
}

function listExtensions() {
  const all = registry.getAll();
  return Object.values(all).map(ext => {
    let electronExt = null;
    try { electronExt = ses.getExtension(ext.id); } catch {}
    return { ...ext, loaded: !!electronExt };
  });
}

function getExtensionErrors(id) {
  return extensionErrors.get(id) || { errors: [], warnings: [], lastError: null };
}

async function loadPersistedExtensions() {
  const all = registry.getAll();
  const results = [];
  for (const [id, ext] of Object.entries(all)) {
    if (ext.enabled && ext.path && fs.existsSync(ext.path)) {
      try {
        const electronExt = await ses.loadExtension(ext.path, { allowFileAccess: false });
        enabledExtensions.set(id, electronExt);
        results.push({ id, name: ext.name, status: 'loaded' });
      } catch (e) {
        addError(id, 'Startup load failed: ' + e.message);
        logger.warn('extensions', 'Failed to load persisted extension', { id, error: e.message });
        results.push({ id, name: ext.name, status: 'error', error: e.message });
      }
    }
  }
  return results;
}

module.exports = {
  init, installFromDir, uninstall, enable, disable, reload,
  getExtensionInfo, listExtensions, loadPersistedExtensions,
  getExtensionErrors, addError, addWarning,
};
