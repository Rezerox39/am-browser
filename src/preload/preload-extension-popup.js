'use strict';
// Preload for extension popup WebContentsViews. This is a MINIMAL surface:
// extension pages get their chrome.* APIs from Electron's extension system,
// NOT from our privileged preload bridge. We expose only two tiny helpers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('amPopup', {
  // Used by extension popups to close themselves (e.g. after an action).
  close: () => ipcRenderer.send('extensions:popupClose'),
  // Current popup context (extension id, url).
  getContext: () => ({ extensionId: null, url: '' }),
});
