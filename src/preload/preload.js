'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  'tabs:getAll', 'tabs:getActiveId', 'tabs:getCurrentUrl',
  'tabs:create', 'tabs:close', 'tabs:setActive', 'tabs:navigate',
  'tabs:reload', 'tabs:stop', 'tabs:goBack', 'tabs:goForward',
  'tabs:showHome', 'tabs:showContent', 'tabs:hideContent',
  'bookmarks:getAll', 'bookmarks:getByUrl', 'bookmarks:add', 'bookmarks:remove',
  'history:getRecent', 'history:search', 'history:clear',
  'downloads:getAll', 'downloads:remove', 'downloads:clear',
  'downloads:openFolder', 'downloads:openFile',
  'settings:get', 'settings:set',
  'site:getRule', 'site:getAllRules', 'site:setRule', 'site:deleteRule', 'site:setPermission',
  'clipboard:copy',
  'window:minimize', 'window:maximize', 'window:close', 'window:isMaximized',
  'i18n:getAvailable', 'i18n:setLocale', 'i18n:getStrings',
  'adblock:getStats', 'adblock:isEnabled',
  'extensions:getAll', 'extensions:list', 'extensions:getInfo',
  'extensions:install', 'extensions:installZip', 'extensions:uninstall',
  'extensions:enable', 'extensions:disable', 'extensions:reload',
  'extensions:openPopup', 'extensions:getPermissions', 'extensions:getManifest',
  'extensions:getErrors',
]);

const ALLOWED_ON = new Set([
  'tabs:changed', 'tabs:focusAddressBar', 'tabs:bookmarkToggled',
  'window:maximized', 'downloads:changed',
  'ui:showHome', 'ui:openMenu', 'ui:esc', 'ui:fullscreen',
  'extensions:updated',
  'menu:state',
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
