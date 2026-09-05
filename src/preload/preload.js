
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Whitelist: only specific channels are allowed for IPC
const ALLOWED_SEND = new Set([
  'tabs:create', 'tabs:close', 'tabs:setActive', 'tabs:navigate',
  'tabs:reload', 'tabs:stop', 'tabs:goBack', 'tabs:goForward',
  'bookmarks:add', 'bookmarks:remove',
  'downloads:remove', 'downloads:clear', 'downloads:openFolder', 'downloads:openFile',
  'settings:set', 'site:setRule', 'site:deleteRule', 'site:setPermission',
  'clipboard:copy',
  'window:minimize', 'window:maximize', 'window:close',
  'i18n:setLocale',
]);

const ALLOWED_INVOKE = new Set([
  'tabs:getAll', 'tabs:getActiveId', 'tabs:getCurrentUrl',
  'bookmarks:getAll', 'bookmarks:getByUrl',
  'history:getRecent', 'history:search', 'history:clear',
  'downloads:getAll',
  'settings:get',
  'site:getRule', 'site:getAllRules',
  'window:isMaximized',
  'i18n:getAvailable',
  'adblock:getStats', 'adblock:isEnabled',
]);

const ALLOWED_ON = new Set([
  'tabs:changed', 'tabs:focusAddressBar', 'tabs:bookmarkToggled',
  'window:maximized', 'downloads:changed',
]);

contextBridge.exposeInMainWorld('am', {
  // invoke (request-response)
  invoke: (channel, ...args) => {
    if (ALLOWED_INVOKE.has(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('Blocked IPC channel: ' + channel));
  },

  // one-way send
  send: (channel, ...args) => {
    if (ALLOWED_SEND.has(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // event listener
  on: (channel, callback) => {
    if (!ALLOWED_ON.has(channel)) return () => {};
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
