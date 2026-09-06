'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../logger');

const REGISTRY_PATH = path.join(app.getPath('userData'), 'extensions', 'registry.json');

let registry = { extensions: {} };

function load() {
  try {
    const dir = path.dirname(REGISTRY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(REGISTRY_PATH)) {
      const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
      registry = JSON.parse(raw);
      if (!registry.extensions) registry.extensions = {};
    }
  } catch (e) {
    logger.warn('extensions', 'Registry load failed, using empty registry', { error: e.message });
    registry = { extensions: {} };
  }
}

function save() {
  try {
    const dir = path.dirname(REGISTRY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
  } catch (e) {
    logger.warn('extensions', 'Registry save failed', { error: e.message });
  }
}

function register(ext) {
  registry.extensions[ext.id] = {
    id: ext.id,
    name: ext.name || 'Unknown',
    version: ext.version || '0.0.0',
    description: ext.description || '',
    enabled: ext.enabled !== false,
    path: ext.path,
    manifestVersion: ext.manifestVersion || 3,
    permissions: ext.permissions || [],
    hostPermissions: ext.hostPermissions || [],
    installTime: ext.installTime || Date.now(),
    icon: ext.icon || null,
  };
  save();
}

function unregister(id) {
  delete registry.extensions[id];
  save();
}

function getAll() {
  return { ...registry.extensions };
}

function get(id) {
  return registry.extensions[id] || null;
}

function setEnabled(id, enabled) {
  if (registry.extensions[id]) {
    registry.extensions[id].enabled = enabled;
    save();
  }
}

function isLoaded(id) {
  return registry.extensions[id]?.enabled ?? false;
}

module.exports = { load, save, register, unregister, getAll, get, setEnabled, isLoaded };
