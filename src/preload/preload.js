'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Every channel the main process handles via ipcMain.handle needs to be in this set.
const ALLOWED_INVOKE = new Set([
  // Tabs
  'tabs:getAll', 'tabs:getActiveId', 'tabs:getCurrentUrl',
  'tabs:create', 'tabs:close', 'tabs:setActive', 'tabs:navigate',
  'tabs:reload', 'tabs:stop', 'tabs:goBack', 'tabs:goForward',
  // Bookmarks
  'bookmarks:getAll', 'bookmarks:getByUrl', 'bookmarks:add', 'bookmarks:remove',
  // History
  'history:getRecent', 'history:search', 'history:clear',
  // Downloads
  'downloads:getAll', 'downloads:remove', 'downloads:clear',
  'downloads:openFolder', 'downloads:openFile',
  // Settings
  'settings:get', 'settings:set',
  // Site rules
  'site:getRule', 'site:getAllRules', 'site:setRule', 'site:deleteRule', 'site:setPermission',
  // Clipboard
  'clipboard:copy',
  // Window
  'window:minimize', 'window:maximize', 'window:close', 'window:isMaximized',
  // i18n
  'i18n:getAvailable', 'i18n:setLocale',
  // Adblock
  'adblock:getStats', 'adblock:isEnabled',
]);

// One-way events from main → renderer
const ALLOWED_ON = new Set([
  'tabs:changed', 'tabs:focusAddressBar', 'tabs:bookmarkToggled',
  'window:maximized', 'downloads:changed',
]);

contextBridge.exposeInMainWorld('am', {
  invoke: (channel, ...args) => {
    if (ALLOWED_INVOKE.has(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('Blocked IPC channel: ' + channel));
  },
  on: (channel, callback) => {
    if (!ALLOWED_ON.has(channel)) return () => {};
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
