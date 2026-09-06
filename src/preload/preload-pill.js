'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const PILL_INVOKE = new Set([
  'tabs:goBack', 'tabs:goForward', 'tabs:create',
  'ui:showHome', 'ui:openMenu', 'ui:focusChrome',
  'ui:openExtensions',
  'i18n:getStrings',
]);

const PILL_ON = new Set(['tabs:changed']);

contextBridge.exposeInMainWorld('am', {
  invoke: (channel, ...args) => {
    if (PILL_INVOKE.has(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error('Blocked pill IPC channel: ' + channel));
  },
  on: (channel, callback) => {
    if (!PILL_ON.has(channel)) return () => {};
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
