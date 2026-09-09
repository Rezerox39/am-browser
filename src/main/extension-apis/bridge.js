'use strict';

const { ipcMain, webContents } = require('electron');
const logger = require('../logger');

// API modules
const storage = require('./storage');
const scripting = require('./scripting');
const alarms = require('./alarms');
const notifications = require('./notifications');
const cookies = require('./cookies');

let registered = false;

/**
 * Register IPC handlers for extension APIs.
 * Called once during app initialization.
 */
function register() {
  if (registered) return;
  registered = true;

  // Main dispatcher: am-ext-api
  // Extension preload scripts send: invoke('am-ext-api', api, method, args)
  ipcMain.handle('am-ext-api', async (event, api, method, ...args) => {
    const sender = event.sender;
    // Determine extension ID from sender URL
    let extensionId = '';
    try {
      const url = sender.getURL();
      const match = url.match(/^chrome-extension:\/\/([a-z]+)/i);
      if (match) extensionId = match[1];
    } catch {}

    try {
      return await dispatch(api, method, extensionId, args);
    } catch (e) {
      logger.warn('extension-bridge', `API error: ${api}.${method}`, { error: e.message });
      return { error: e.message };
    }
  });

  logger.info('extension-bridge', 'IPC handlers registered');
}

async function dispatch(api, method, extensionId, args) {
  const a = args[0] || {};

  switch (api) {
    // ── chrome.storage ──────────────────────────────────────
    case 'storage': {
      const area = a._area || 'local';
      switch (method) {
        case 'get': return storage.handleStorageGet(extensionId, area, a.keys);
        case 'set': storage.handleStorageSet(extensionId, area, a.items); return;
        case 'remove': storage.handleStorageRemove(extensionId, area, a.keys); return;
        case 'clear': storage.handleStorageClear(extensionId, area); return;
        case 'getBytesInUse': return storage.handleStorageGetBytesInUse(extensionId, area, a.keys);
        default: throw new Error(`storage.${method} not implemented`);
      }
    }

    // ── chrome.scripting ────────────────────────────────────
    case 'scripting': {
      switch (method) {
        case 'executeScript': return scripting.handleExecuteScript(a);
        case 'insertCSS': return scripting.handleInsertCSS(a);
        case 'removeCSS': return scripting.handleRemoveCSS(a);
        default: throw new Error(`scripting.${method} not implemented`);
      }
    }

    // ── chrome.alarms ───────────────────────────────────────
    case 'alarms': {
      switch (method) {
        case 'create': alarms.handleAlarmCreate(extensionId, a.name, a.alarmInfo || {}); return;
        case 'get': return alarms.handleAlarmGet(extensionId, a.name);
        case 'getAll': return alarms.handleAlarmGetAll(extensionId);
        case 'clear': return alarms.handleAlarmClear(extensionId, a.name);
        case 'clearAll': return alarms.handleAlarmClearAll(extensionId);
        default: throw new Error(`alarms.${method} not implemented`);
      }
    }

    // ── chrome.notifications ────────────────────────────────
    case 'notifications': {
      switch (method) {
        case 'create': return notifications.handleNotificationCreate(a);
        case 'clear': return notifications.handleNotificationClear(a.id);
        case 'getAll': return notifications.handleNotificationGetAll();
        default: throw new Error(`notifications.${method} not implemented`);
      }
    }

    // ── chrome.cookies ──────────────────────────────────────
    case 'cookies': {
      switch (method) {
        case 'get': return cookies.handleCookieGet(a);
        case 'getAll': return cookies.handleCookieGetAll(a);
        case 'set': return cookies.handleCookieSet(a);
        case 'remove': return cookies.handleCookieRemove(a);
        default: throw new Error(`cookies.${method} not implemented`);
      }
    }

    default:
      throw new Error(`Unknown extension API: ${api}`);
  }
}

module.exports = { register };
