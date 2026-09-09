'use strict';
/**
 * Extension Bridge Preload
 *
 * Injected into extension contexts (chrome-extension:// pages) to provide
 * missing Chrome APIs that Electron doesn't implement natively.
 *
 * The `electron-chrome-extensions` library already provides:
 *   chrome.tabs, chrome.runtime, chrome.action, chrome.contextMenus,
 *   chrome.windows, chrome.commands
 *
 * This bridge adds:
 *   chrome.storage.local/sync/session
 *   chrome.scripting.executeScript/insertCSS/removeCSS
 *   chrome.alarms
 *   chrome.notifications
 *   chrome.cookies
 */
const { contextBridge, ipcRenderer } = require('electron');

// Only run in extension contexts
if (!location.href.startsWith('chrome-extension://')) return;

const api = {
  invoke: (apiName, method, ...args) => ipcRenderer.invoke('am-ext-api', apiName, method, ...args),
  onAlarm: (callback) => ipcRenderer.on('am-ext-alarm', (event, extId, name) => callback(name)),
};

// Expose to main world via contextBridge
try {
  contextBridge.exposeInMainWorld('__amExtBridge', api);
} catch {
  // Already in main world — expose directly
  window.__amExtBridge = api;
}

// Inject chrome.* API patches into the main world
const bridgeScript = `
(function() {
  if (window.__bridgeInjected) return;
  window.__bridgeInjected = true;

  const bridge = window.__amExtBridge;
  if (!bridge) return;

  const chrome = window.chrome || {};
  const pendingListeners = {};

  // ── Helper: create a Chrome-style event ─────────────────
  function createChromeEvent() {
    const listeners = new Set();
    const eventObj = {
      addListener(fn) { listeners.add(fn); },
      removeListener(fn) { listeners.delete(fn) },
      hasListener(fn) { return listeners.has(fn); },
      fire(...args) { for (const fn of listeners) { try { fn(...args); } catch {} } },
    };
    eventObj.dispatch = eventObj.fire;
    return eventObj;
  }

  // ── chrome.storage ──────────────────────────────────────
  if (!chrome.storage) chrome.storage = {};

  function createStorageArea(area) {
    const onChanged = createChromeEvent();
    return {
      get(keys, callback) {
        const promise = bridge.invoke('storage', 'get', { keys, _area: area });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      set(items, callback) {
        const promise = bridge.invoke('storage', 'set', { items, _area: area });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      remove(keys, callback) {
        const promise = bridge.invoke('storage', 'remove', { keys, _area: area });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      clear(callback) {
        const promise = bridge.invoke('storage', 'clear', { _area: area });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      getBytesInUse(keys, callback) {
        const promise = bridge.invoke('storage', 'getBytesInUse', { keys, _area: area });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      onChanged,
    };
  }

  chrome.storage.local = createStorageArea('local');
  chrome.storage.sync = createStorageArea('sync');
  chrome.storage.session = createStorageArea('session');

  // ── chrome.scripting ────────────────────────────────────
  if (!chrome.scripting) {
    chrome.scripting = {
      executeScript(details, callback) {
        const promise = bridge.invoke('scripting', 'executeScript', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      insertCSS(details, callback) {
        const promise = bridge.invoke('scripting', 'insertCSS', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      removeCSS(details, callback) {
        const promise = bridge.invoke('scripting', 'removeCSS', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
    };
  }

  // ── chrome.alarms ───────────────────────────────────────
  if (!chrome.alarms) {
    const onAlarm = createChromeEvent();

    chrome.alarms = {
      create(name, alarmInfo) {
        bridge.invoke('alarms', 'create', { name, alarmInfo });
      },
      get(name, callback) {
        const promise = bridge.invoke('alarms', 'get', { name });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      getAll(callback) {
        const promise = bridge.invoke('alarms', 'getAll', {});
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      clear(name, callback) {
        const promise = bridge.invoke('alarms', 'clear', { name });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      clearAll(callback) {
        const promise = bridge.invoke('alarms', 'clearAll', {});
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      onAlarm,
    };

    // Listen for alarm events from main process
    if (bridge.onAlarm) {
      bridge.onAlarm((name) => {
        onAlarm.fire({ name });
      });
    }
  }

  // ── chrome.notifications ────────────────────────────────
  if (!chrome.notifications) {
    chrome.notifications = {
      create(id, options, callback) {
        if (typeof options === 'function') { callback = options; options = id; id = ''; }
        if (typeof id === 'object' && !callback) { options = id; id = ''; }
        const details = { id, title: options?.title, message: options?.message, type: options?.type, iconUrl: options?.iconUrl, priority: options?.priority };
        const promise = bridge.invoke('notifications', 'create', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      clear(id, callback) {
        const promise = bridge.invoke('notifications', 'clear', { id });
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      getAll(callback) {
        const promise = bridge.invoke('notifications', 'getAll', {});
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      onClicked: createChromeEvent(),
      onClosed: createChromeEvent(),
    };
  }

  // ── chrome.cookies ──────────────────────────────────────
  if (!chrome.cookies) {
    chrome.cookies = {
      get(details, callback) {
        const promise = bridge.invoke('cookies', 'get', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      getAll(details, callback) {
        const promise = bridge.invoke('cookies', 'getAll', details || {});
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      set(details, callback) {
        const promise = bridge.invoke('cookies', 'set', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      remove(details, callback) {
        const promise = bridge.invoke('cookies', 'remove', details);
        if (typeof callback === 'function') promise.then(callback);
        return promise;
      },
      onChanged: createChromeEvent(),
    };
  }

  // Patch the global chrome object
  window.chrome = chrome;
})();
`;

// Inject via contextBridge + webFrame.executeJavaScript (same pattern as electron-chrome-extensions)
try {
  const { webFrame } = require('electron');
  webFrame.executeJavaScript(bridgeScript);
} catch {}
