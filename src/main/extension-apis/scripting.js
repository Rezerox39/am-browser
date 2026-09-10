'use strict';

const { webContents } = require('electron');

function findTab(tabId) {
  if (!tabId) throw new Error('tabId is required');
  const wc = webContents.getAllWebContents().find(w => w.id === tabId);
  if (!wc || wc.isDestroyed()) throw new Error(`Tab ${tabId} not found`);
  return wc;
}

async function executeScript({ context, args }) {
  const [details = {}] = args;
  const target = details.target;
  if (!target || !target.tabId) throw new Error('target.tabId is required');
  const wc = findTab(target.tabId);
  const results = [];

  if (details.files && Array.isArray(details.files)) {
    for (const file of details.files) {
      try {
        await wc.executeJavaScript(`(function(){var s=document.createElement('script');s.src=${JSON.stringify(file)};document.head.appendChild(s);})()`, true);
        results.push({ result: null });
      } catch (e) {
        results.push({ error: e.message });
      }
    }
    return results;
  }

  if (details.func) {
    const code = typeof details.func === 'string' ? details.func : `(${details.func.toString()})()`;
    try {
      const result = await wc.executeJavaScript(code, true);
      return [{ result }];
    } catch (e) {
      return [{ error: e.message }];
    }
  }

  throw new Error('func or files required');
}

async function insertCSS({ context, args }) {
  const [details = {}] = args;
  if (!details.target || !details.target.tabId) throw new Error('target.tabId is required');
  const wc = findTab(details.target.tabId);

  if (details.css) {
    await wc.insertCSS(details.css);
    return { result: null };
  }
  if (details.files && Array.isArray(details.files)) {
    for (const f of details.files) {
      try { await wc.insertCSS(`@import url("${f}");`); } catch {}
    }
    return { result: null };
  }
  throw new Error('css or files required');
}

async function removeCSS() { return { result: null }; }

module.exports = { executeScript, insertCSS, removeCSS };
