'use strict';

const { BrowserWindow } = require('electron');
const crypto = require('crypto');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');

function genId() {
  return 'tab_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

let tabs = [];
let activeTabId = null;
let chromeWin = null;
let activeTabWin = null;

function setChromeWindow(win) { chromeWin = win; }

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || tabs[0] || null;
}

function getAll() {
  return tabs.map((t) => ({
    id: t.id, url: t.url, title: t.title,
    favicon: t.favicon, loading: t.loading, isActive: t.id === activeTabId,
  }));
}

/* ── Tab window geometry (matches chrome layout) ────────────── */
function getContentBounds() {
  if (!chromeWin) return { x: 0, y: 0, width: 1280, height: 800 };
  const [w, h] = chromeWin.getSize();
  return { x: 12, y: 86, width: Math.max(200, w - 24), height: Math.max(200, h - 140) };
}

/* ── Tab creation ──────────────────────────────────────────── */
function create(opts = {}) {
  const tab = {
    id: genId(),
    url: opts.url || '',
    title: opts.title || '',
    favicon: '',
    loading: false,
    win: null,
    history: opts.url ? [opts.url] : [],
    historyIndex: opts.url ? 0 : -1,
  };
  tabs.push(tab);

  if (chromeWin) {
    const bounds = getContentBounds();
    const tabWin = new BrowserWindow({
      parent: chromeWin,
      x: chromeWin.getPosition()[0] + bounds.x,
      y: chromeWin.getPosition()[1] + bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
      },
    });

    // Navigation events
    tabWin.webContents.on('did-navigate', (e, url) => {
      tab.url = url;
      // Update history (skip if it's just an in-page navigation we already tracked)
      if (tab.historyIndex < 0 || tab.history[tab.historyIndex] !== url) {
        // Truncate forward history if we navigated to a new URL
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
      history.add({ url, title: tab.title || url });
      broadcast();
    });
    tabWin.webContents.on('did-navigate-in-page', (e, url) => {
      tab.url = url;
      if (tab.historyIndex < 0 || tab.history[tab.historyIndex] !== url) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
      history.add({ url, title: tab.title || url });
      broadcast();
    });
    tabWin.webContents.on('page-title-updated', (e, title) => {
      tab.title = title;
      broadcast();
    });
    tabWin.webContents.on('page-favicon-updated', (e, favicons) => {
      if (favicons && favicons.length > 0) tab.favicon = favicons[0];
    });
    tabWin.webContents.on('did-start-loading', () => { tab.loading = true; broadcast(); });
    tabWin.webContents.on('did-stop-loading', () => { tab.loading = false; broadcast(); });
    tabWin.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedUrl) => {
      tab.loading = false;
      tab.title = 'Error — ' + (errorDesc || errorCode);
      logger.warn('tabs', 'Page failed to load', { url: validatedUrl, errorDesc });
      broadcast();
    });

    // Popup handler
    tabWin.webContents.setWindowOpenHandler(({ url }) => {
      if (!url || url.startsWith('about:') || url.startsWith('javascript:')) return { action: 'deny' };
      create({ url });
      return { action: 'deny' };
    });

    // Keyboard shortcuts inside web content
    tabWin.webContents.on('before-input-event', (event, input) => {
      const mods = input.control || input.meta;
      if (!mods) return;
      if (input.key === 't') { event.preventDefault(); create(); }
      else if (input.key === 'w') { event.preventDefault(); close(tab.id); }
      else if (input.key === 'l') {
        event.preventDefault();
        if (chromeWin && !chromeWin.webContents.isDestroyed()) {
          chromeWin.webContents.send('tabs:focusAddressBar');
        }
      } else if (input.key === 'r' && !input.shift) { event.preventDefault(); reload(tab.id); }
      else if (input.key === 'd') {
        event.preventDefault();
        const bookmarks = require('./bookmarks');
        const existing = bookmarks.getByUrl(tab.url);
        if (existing) bookmarks.remove(existing.id);
        else bookmarks.add({ url: tab.url, title: tab.title, favicon: tab.favicon });
        broadcast();
      }
    });

    // Apply site-specific settings before loading
    if (tab.url) {
      let parsedHost = '';
      try { parsedHost = new URL(tab.url).hostname; } catch {}
      const siteRules = config.get().siteRules || {};
      const rule = siteRules[parsedHost] || {};
      if (rule.javascript === false) tabWin.webContents.setJavaScriptEnabled(false);
      if (rule.userAgent) tabWin.webContents.setUserAgent(rule.userAgent);

      tabWin.webContents.loadURL(tab.url).catch((err) => {
        logger.warn('tabs', 'Failed to load URL', { url: tab.url, error: err.message });
      });
    }

    tab.win = tabWin;
  }

  setActive(tab.id);
  broadcast();
  logger.info('tabs', 'Tab created', { id: tab.id, url: tab.url || '(blank)' });
  return tab;
}

/* ── Tab switching ─────────────────────────────────────────── */
function setActive(tabId) {
  const next = tabs.find((t) => t.id === tabId);
  if (!next) return;

  // Hide all tab windows
  for (const t of tabs) {
    if (t.win && !t.win.isDestroyed()) {
      t.win.hide();
    }
  }

  activeTabId = tabId;

  // Show the active tab's window (if it has a URL loaded)
  if (next.win && !next.win.isDestroyed() && next.url) {
    next.win.show();
    activeTabWin = next.win;
    repositionActiveTab();
  } else {
    activeTabWin = null;
  }

  broadcast();
}

function close(tabId) {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tab.win && !tab.win.isDestroyed()) {
    tab.win.destroy();
  }
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    create();
    return;
  }
  if (activeTabId === tabId) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    setActive(next.id);
  } else {
    broadcast();
  }
}

/* ── Navigation ────────────────────────────────────────────── */
function navigate(tabId, url) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (!tab.win || tab.win.isDestroyed()) return;

  let parsedHost = '';
  try { parsedHost = new URL(url).hostname; } catch {}
  const siteRules = config.get().siteRules || {};
  const rule = siteRules[parsedHost] || {};
  tab.win.webContents.setJavaScriptEnabled(rule.javascript !== false);
  if (rule.userAgent) tab.win.webContents.setUserAgent(rule.userAgent);
  else tab.win.webContents.setUserAgent('');

  tab.url = url;
  tab.loading = true;

  // Ensure this tab is visible
  setActive(tabId);

  broadcast();

  logger.info('tabs', 'Navigating', { tabId, url });
  tab.win.webContents.loadURL(url).catch((err) => {
    tab.title = 'Error — ' + (err.message || 'Failed to load');
    tab.loading = false;
    broadcast();
  });
}

function reload(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (!tab || !tab.win || tab.win.isDestroyed()) return;
  tab.loading = true;
  broadcast();
  tab.win.webContents.reload();
}

function stop(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (!tab || !tab.win || tab.win.isDestroyed()) return;
  tab.win.webContents.stop();
  tab.loading = false;
  broadcast();
}

function goBack(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (!tab || !tab.win || tab.win.isDestroyed()) return;
  if (tab.historyIndex > 0) {
    tab.historyIndex--;
    const prevUrl = tab.history[tab.historyIndex];
    tab.win.webContents.loadURL(prevUrl).catch(() => {});
  }
}

function goForward(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (!tab || !tab.win || tab.win.isDestroyed()) return;
  if (tab.historyIndex < tab.history.length - 1) {
    tab.historyIndex++;
    const nextUrl = tab.history[tab.historyIndex];
    tab.win.webContents.loadURL(nextUrl).catch(() => {});
  }
}

/* ── Show/hide (called from renderer) ──────────────────────── */
function showHome() {
  if (activeTabWin && !activeTabWin.isDestroyed()) {
    activeTabWin.hide();
    activeTabWin = null;
  }
}

function showContent() {
  const active = getActiveTab();
  if (active && active.win && !active.win.isDestroyed() && active.url) {
    active.win.show();
    activeTabWin = active.win;
    repositionActiveTab();
  }
}

/* ── Reposition ────────────────────────────────────────────── */
function repositionActiveTab() {
  if (!activeTabWin || activeTabWin.isDestroyed() || !chromeWin) return;
  const bounds = getContentBounds();
  const [cx, cy] = chromeWin.getPosition();
  try {
    activeTabWin.setBounds({
      x: cx + bounds.x,
      y: cy + bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  } catch {}
}

/* ── Broadcast ─────────────────────────────────────────────── */
function broadcast() {
  if (chromeWin && !chromeWin.webContents.isDestroyed()) {
    const active = getActiveTab();
    chromeWin.webContents.send('tabs:changed', getAll(), active?.id || null, active?.url || '', active?.title || '');
  }
}

function getStateForContentsId(wcId) {
  const tab = tabs.find((t) => t.win && !t.win.isDestroyed() && t.win.webContents.id === wcId);
  if (!tab) return {};
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  const siteRules = config.get().siteRules || {};
  return { tabId: tab.id, host, rule: siteRules[host] || {} };
}

function init(opts = {}) {
  setChromeWindow(opts.window);
  create(opts);
}

module.exports = {
  init, create, close, setActive, navigate, reload, stop,
  goBack, goForward, getActiveTab, getAll, setChromeWindow,
  getStateForContentsId, broadcast,
  showHome, showContent, repositionActiveTab,
};
