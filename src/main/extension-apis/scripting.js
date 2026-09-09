'use strict';

const { webContents } = require('electron');
const logger = require('../logger');

// chrome.scripting.executeScript
function handleExecuteScript(args) {
  const { target, func, files, world } = args || {};
  if (!target) return Promise.reject(new Error('target is required'));

  let wc = null;
  if (target.tabId) {
    wc = webContents.getAllWebContents().find(w => w.id === target.tabId);
  }
  if (!wc || wc.isDestroyed()) return Promise.reject(new Error('Tab not found'));

  const results = [];

  if (files && Array.isArray(files)) {
    // Inject JS files
    const promises = files.map(file =>
      wc.executeJavaScript(`(function(){var s=document.createElement('script');s.src=${JSON.stringify(file)};document.head.appendChild(s);})()`, true)
        .then(() => results.push({ result: null }))
        .catch(e => results.push({ error: e.message }))
    );
    return Promise.all(promises).then(() => results);
  }

  if (func) {
    // Execute function in page context
    const code = typeof func === 'string' ? func : `(${func.toString()})()`;
    return wc.executeJavaScript(code, true)
      .then(result => [{ result }])
      .catch(e => [{ error: e.message }]);
  }

  return Promise.reject(new Error('func or files required'));
}

// chrome.scripting.insertCSS
function handleInsertCSS(args) {
  const { target, css, files } = args || {};
  if (!target) return Promise.reject(new Error('target is required'));

  let wc = null;
  if (target.tabId) {
    wc = webContents.getAllWebContents().find(w => w.id === target.tabId);
  }
  if (!wc || wc.isDestroyed()) return Promise.reject(new Error('Tab not found'));

  if (css) {
    return wc.insertCSS(css).then(() => ({ result: null })).catch(e => ({ error: e.message }));
  }
  if (files && Array.isArray(files)) {
    const promises = files.map(f =>
      wc.insertCSS(`@import url("${f}");`).catch(() => {})
    );
    return Promise.all(promises).then(() => ({ result: null }));
  }
  return Promise.reject(new Error('css or files required'));
}

// chrome.scripting.removeCSS
function handleRemoveCSS(args) {
  // Electron doesn't support removing specific injected CSS
  // Return success silently
  return Promise.resolve({ result: null });
}

module.exports = {
  handleExecuteScript,
  handleInsertCSS,
  handleRemoveCSS,
};
