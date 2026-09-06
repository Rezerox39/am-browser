'use strict';

const fs = require('fs');
const path = require('path');
const { app, session, dialog } = require('electron');
const logger = require('../logger');
const registry = require('./registry');

const EXTENSIONS_DIR = path.join(app.getPath('userData'), 'extensions', 'installed');

let ses = null;
let enabledExtensions = new Map(); // id -> Electron Extension object

function init() {
  ses = session.defaultSession;
  registry.load();
  // Ensure extensions directory exists
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }
  logger.info('extensions', 'Extension manager initialized');
}

async function installFromDir(sourceDir) {
  // Validate manifest.json exists
  const manifestPath = path.join(sourceDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('No manifest.json found in extension directory');
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error('Invalid manifest.json: ' + e.message);
  }

  // Validate required fields
  if (!manifest.name) throw new Error('manifest.json missing "name"');
  if (!manifest.version) throw new Error('manifest.json missing "version"');
  if (!manifest.manifest_version) throw new Error('manifest.json missing "manifest_version"');

  const mv = manifest.manifest_version;
  if (mv !== 2 && mv !== 3) {
    throw new Error('Unsupported manifest_version: ' + mv + ' (only 2 and 3 supported)');
  }

  // Generate a stable extension ID from the path
  const extId = generateExtensionId(sourceDir);
  const destDir = path.join(EXTENSIONS_DIR, extId);

  // Copy extension into managed storage
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.cpSync(sourceDir, destDir, { recursive: true });

  // Load into Electron session
  let electronExt;
  try {
    electronExt = await ses.loadExtension(destDir, { allowFileAccess: false });
  } catch (e) {
    // Clean up on failure
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
    throw new Error('Electron failed to load extension: ' + e.message);
  }

  // Register in persistent registry
  registry.register({
    id: electronExt.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    enabled: true,
    path: destDir,
    manifestVersion: mv,
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
    icon: manifest.icon || null,
  });

  enabledExtensions.set(electronExt.id, electronExt);
  logger.info('extensions', 'Extension installed', { id: electronExt.id, name: manifest.name, version: manifest.version });
  return electronExt.id;
}

async function uninstall(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);

  // Remove from Electron session
  try {
    ses.removeExtension(id);
  } catch (e) {
    logger.warn('extensions', 'Electron removeExtension failed', { error: e.message });
  }

  // Remove files
  try {
    if (ext.path && fs.existsSync(ext.path)) {
      fs.rmSync(ext.path, { recursive: true, force: true });
    }
  } catch (e) {
    logger.warn('extensions', 'File removal failed', { error: e.message });
  }

  // Remove from registry
  registry.unregister(id);
  enabledExtensions.delete(id);
  logger.info('extensions', 'Extension uninstalled', { id });
}

async function enable(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);

  if (ext.enabled) return; // already enabled

  // Load into session
  try {
    const electronExt = await ses.loadExtension(ext.path, { allowFileAccess: false });
    enabledExtensions.set(id, electronExt);
    registry.setEnabled(id, true);
    logger.info('extensions', 'Extension enabled', { id, name: ext.name });
  } catch (e) {
    throw new Error('Failed to enable extension: ' + e.message);
  }
}

async function disable(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);

  if (!ext.enabled) return; // already disabled

  // Remove from Electron session
  try {
    ses.removeExtension(id);
  } catch (e) {
    logger.warn('extensions', 'Electron removeExtension failed', { error: e.message });
  }

  registry.setEnabled(id, false);
  enabledExtensions.delete(id);
  logger.info('extensions', 'Extension disabled', { id, name: ext.name });
}

async function reload(id) {
  const ext = registry.get(id);
  if (!ext) throw new Error('Extension not found: ' + id);

  if (ext.enabled) {
    await disable(id);
    await enable(id);
  }
}

function getExtensionInfo(id) {
  const ext = registry.get(id);
  if (!ext) return null;

  // Get Electron extension object for additional info
  let electronExt = null;
  try {
    electronExt = ses.getExtension(id);
  } catch {}

  return {
    ...ext,
    loaded: !!electronExt,
    electronName: electronExt?.manifest?.name || ext.name,
    manifest: electronExt?.manifest || null,
  };
}

function listExtensions() {
  const all = registry.getAll();
  return Object.values(all).map(ext => {
    let electronExt = null;
    try { electronExt = ses.getExtension(ext.id); } catch {}
    return {
      ...ext,
      loaded: !!electronExt,
    };
  });
}

function generateExtensionId(dir) {
  // Generate a stable ID from the extension directory path
  const crypto = require('crypto');
  return crypto.createHash('md5').update(path.resolve(dir)).digest('hex').substring(0, 32);
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
};
