'use strict';

const { WebContentsView } = require('electron');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');

function genId() {
  return 'tab_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

let tabs = [];
let activeTabId = null;
let chromeWin = null;
const viewBounds = { x: 12, y: 86, width: 1000, height: 700 };

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

/* ── View management ───────────────────────────────────────── */
function removeAllChildViews() {
  if (!chromeWin) return;
  const children = chromeWin.contentView.children.slice();
  for (const child of children) {
    try { chromeWin.contentView.removeChildView(child); } catch {}
  }
  // Clear flags
  for (const t of tabs) {
    if (t.view) t.view._isAttached = false;
  }
}

function ensureViewAttached(view) {
  if (!chromeWin || !view) return;
  // Always remove first to reset state cleanly
  try { chromeWin.contentView.removeChildView(view); } catch {}
  view._isAttached = false;
  // Now add
  try {
    chromeWin.contentView.addChildView(view);
    view._isAttached = true;
    updateViewBounds();
  } catch (e) {
    logger.error('tabs', 'Failed to attach view', { error: e.message });
  }
}

function detachView(view) {
  if (!chromeWin || !view) return;
  try { chromeWin.contentView.removeChildView(view); } catch {}
  view._isAttached = false;
}

function showActiveView() {
  const active = getActiveTab();
  if (!active || !active.view) return;
  ensureViewAttached(active.view);
}

function hideActiveView() {
  const active = getActiveTab();
  if (active && active.view) detachView(active.view);
}

/* ── Tab creation ──────────────────────────────────────────── */
function create(opts = {}) {
  const tab = {
    id: genId(),
    url: opts.url || '',
    title: opts.title || '',
    favicon: '',
    loading: false,
    view: null,
  };
  tabs.push(tab);

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  });
  view._isAttached = false;

  // Site-specific settings
  const siteRules = config.get().siteRules || {};
  const parsedUrl = tab.url ? (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })() : '';
  const rule = siteRules[parsedUrl] || {};
  if (rule.javascript === false) view.webContents.setJavaScriptEnabled(false);
  if (rule.userAgent) view.webContents.setUserAgent(rule.userAgent);

  // Navigation events
  view.webContents.on('did-navigate', (e, url) => {
    tab.url = url;
    history.add({ url, title: tab.title || url });
    broadcast();
  });
  view.webContents.on('did-navigate-in-page', (e, url) => {
    tab.url = url;
    history.add({ url, title: tab.title || url });
    broadcast();
  });
  view.webContents.on('page-title-updated', (e, title) => {
    tab.title = title;
    broadcast();
  });
  view.webContents.on('page-favicon-updated', (e, favicons) => {
    if (favicons && favicons.length > 0) tab.favicon = favicons[0];
  });
  view.webContents.on('did-start-loading', () => { tab.loading = true; broadcast(); });
  view.webContents.on('did-stop-loading', () => { tab.loading = false; broadcast(); });
  view.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedUrl) => {
    tab.loading = false;
    tab.title = 'Error — ' + (errorDesc || errorCode);
    logger.warn('tabs', 'Page failed to load', { url: validatedUrl, errorCode, errorDesc });
    broadcast();
  });

  // Popup handler
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url.startsWith('about:') || url.startsWith('javascript:')) return { action: 'deny' };
    create({ url });
    return { action: 'deny' };
  });

  // Keyboard shortcuts inside web content
  view.webContents.on('before-input-event', (event, input) => {
    const mods = input.control || input.meta;
    if (!mods) return;
    if (input.key === 't') {
      event.preventDefault();
      create();
    } else if (input.key === 'w') {
      event.preventDefault();
      close(tab.id);
    } else if (input.key === 'l') {
      event.preventDefault();
      if (chromeWin && !chromeWin.webContents.isDestroyed()) {
        chromeWin.webContents.send('tabs:focusAddressBar');
      }
    } else if (input.key === 'r' && !input.shift) {
      event.preventDefault();
      reload(tab.id);
    } else if (input.key === 'd') {
      event.preventDefault();
      const bookmarks = require('./bookmarks');
      const existing = bookmarks.getByUrl(tab.url);
      if (existing) bookmarks.remove(existing.id);
      else bookmarks.add({ url: tab.url, title: tab.title, favicon: tab.favicon });
      broadcast();
    }
  });

  tab.view = view;

  if (tab.url) {
    view.webContents.loadURL(tab.url).catch((err) => {
      logger.warn('tabs', 'Failed to load URL', { url: tab.url, error: err.message });
    });
  } else {
    tab.title = 'New Tab';
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
  activeTabId = tabId;
  removeAllChildViews();
  if (next.view && next.url) {
    ensureViewAttached(next.view);
  }
  broadcast();
}

function close(tabId) {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tab.view) {
    detachView(tab.view);
    if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }
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
  if (!tab || !tab.view) {
    logger.error('tabs', 'navigate: tab or view missing', { tabId, url });
    return;
  }

  // Apply site-specific settings
  let parsedHost = '';
  try { parsedHost = new URL(url).hostname; } catch {}
  const siteRules = config.get().siteRules || {};
  const rule = siteRules[parsedHost] || {};
  tab.view.webContents.setJavaScriptEnabled(rule.javascript !== false);
  if (rule.userAgent) tab.view.webContents.setUserAgent(rule.userAgent);
  else tab.view.webContents.setUserAgent('');

  tab.url = url;
  tab.title = '';
  tab.loading = true;

  // ENSURE this tab's view is attached — clean approach
  ensureViewAttached(tab.view);

  broadcast();

  logger.info('tabs', 'Navigating', { tabId, url });

  tab.view.webContents.loadURL(url).catch((err) => {
    tab.title = 'Error — ' + (err.message || 'Failed to load');
    tab.loading = false;
    logger.warn('tabs', 'Navigation failed', { url, error: err.message });
    broadcast();
  });
}

function reload(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (!tab || !tab.view) return;
  tab.loading = true;
  broadcast();
  tab.view.webContents.reload();
}

function stop(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (!tab || !tab.view) return;
  tab.view.webContents.stop();
  tab.loading = false;
  broadcast();
}

function goBack(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (tab && tab.view && tab.view.webContents.canGoBack()) {
    tab.view.webContents.goBack();
  }
}

function goForward(tabId) {
  const tab = tabs.find((t) => t.id === (tabId || activeTabId));
  if (tab && tab.view && tab.view.webContents.canGoForward()) {
    tab.view.webContents.goForward();
  }
}

/* ── Public show/hide ──────────────────────────────────────── */
function showHome() {
  hideActiveView();
  logger.info('tabs', 'showHome: view detached');
}
function showContent() {
  showActiveView();
  logger.info('tabs', 'showContent: view attached');
}

/* ── Bounds & broadcast ────────────────────────────────────── */
function updateViewBounds() {
  if (!chromeWin) return;
  const [w, h] = chromeWin.getSize();
  viewBounds.x = 12;
  viewBounds.y = 86;
  viewBounds.width = Math.max(200, w - 24);
  viewBounds.height = Math.max(200, h - 140);
  const active = getActiveTab();
  if (active && active.view) {
    try { active.view.setBounds(viewBounds); } catch {}
  }
}

function broadcast() {
  if (chromeWin && !chromeWin.webContents.isDestroyed()) {
    const all = getAll();
    const active = getActiveTab();
    chromeWin.webContents.send('tabs:changed', all, active?.id || null, active?.url || '', active?.title || '');
  }
}

function getStateForContentsId(wcId) {
  const tab = tabs.find((t) => t.view && t.view.webContents && t.view.webContents.id === wcId);
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
  updateViewBounds, getStateForContentsId, broadcast,
  showHome, showContent,
};
