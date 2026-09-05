
'use strict';

const { WebContentsView, session } = require('electron');
const { v4: uuidv4 } = require('crypto');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');
const bookmarks = require('./bookmarks');

const crypto = require('crypto');

function genId() {
  return 'tab_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

let tabs = [];
let activeTabId = null;
let chromeWin = null;
const viewBounds = { x: 260, y: 70, width: 1000, height: 700 };

function setChromeWindow(win) {
  chromeWin = win;
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || tabs[0] || null;
}

function getAll() {
  return tabs.map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    favicon: t.favicon,
    loading: t.loading,
    isActive: t.id === activeTabId,
  }));
}

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

  // Create WebContentsView for this tab
  const ses = session.defaultSession;
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

  // Set site-specific JS
  const siteRules = config.get().siteRules || {};
  const parsedUrl = tab.url ? (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })() : '';
  const rule = siteRules[parsedUrl] || {};
  if (rule.javascript === false) view.webContents.setJavaScriptEnabled(false);
  if (rule.userAgent) view.webContents.setUserAgent(rule.userAgent);

  // Handle navigation events
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
  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    broadcast();
  });
  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    broadcast();
  });
  view.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedUrl) => {
    tab.loading = false;
    tab.title = 'Error';
    broadcast();
  });

  // Handle popups: route to new tab
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url.startsWith('about:') || url.startsWith('javascript:')) return { action: 'deny' };
    create({ url });
    return { action: 'deny' };
  });

  // Keyboard shortcuts in web content
  view.webContents.on('before-input-event', (event, input) => {
    const mods = input.control || input.meta;
    if (!mods) return;
    if (input.key === 't') {
      event.preventDefault();
      create();
      setActive(tab.id); // will be set to the new tab
      const newTab = tabs[tabs.length - 1];
      setActive(newTab.id);
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
      const existing = bookmarks.getByUrl(tab.url);
      if (existing) {
        bookmarks.remove(existing.id);
      } else {
        bookmarks.add({ url: tab.url, title: tab.title, favicon: tab.favicon });
      }
      broadcast();
      if (chromeWin && !chromeWin.webContents.isDestroyed()) {
        chromeWin.webContents.send('tabs:bookmarkToggled', { url: tab.url, bookmarked: !existing });
      }
    }
  });

  tab.view = view;

  // Load URL or leave empty for new tab
  if (tab.url) {
    view.webContents.loadURL(tab.url).catch((err) => {
      logger.warn('tabs', 'Failed to load URL', { url: tab.url, error: err.message });
    });
  } else {
    tab.title = 'New Tab';
  }

  setActive(tab.id);
  updateViewBounds();
  broadcast();
  return tab;
}

function close(tabId) {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const tab = tabs[idx];
  // Remove from window
  if (chromeWin && tab.view) {
    try { chromeWin.contentView.removeChildView(tab.view); } catch {}
  }
  if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.close();
  }
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    create(); // always keep at least one tab
    return;
  }
  if (activeTabId === tabId) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    setActive(next.id);
  }
  broadcast();
}

function setActive(tabId) {
  const prev = getActiveTab();
  activeTabId = tabId;
  const next = getActiveTab();
  if (!next) return;

  // Hide previous view
  if (prev && prev.view && prev !== next) {
    try { chromeWin.contentView.removeChildView(prev.view); } catch {}
  }

  // Show next view
  if (chromeWin && next.view) {
    try { chromeWin.contentView.addChildView(next.view); } catch {}
    updateViewBounds();
  }

  broadcast();
}

function navigate(tabId, url) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || !tab.view) return;

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
  broadcast();

  tab.view.webContents.loadURL(url).catch((err) => {
    tab.title = 'Error';
    tab.loading = false;
    broadcast();
    logger.warn('tabs', 'Navigation failed', { url, error: err.message });
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

function updateViewBounds() {
  if (!chromeWin) return;
  const [w, h] = chromeWin.getSize();
  viewBounds.width = Math.max(200, w - 280);
  viewBounds.height = Math.max(200, h - 90);
  const active = getActiveTab();
  if (active && active.view) {
    try { active.view.setBounds(viewBounds); } catch {}
  }
}

function broadcast() {
  if (chromeWin && !chromeWin.webContents.isDestroyed()) {
    chromeWin.webContents.send('tabs:changed', getAll(), activeTabId);
  }
}

function getStateForContentsId(wcId) {
  // Find tab by webContents id
  const tab = tabs.find((t) => t.view && t.view.webContents && t.view.webContents.id === wcId);
  if (!tab) return {};
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  const siteRules = config.get().siteRules || {};
  return { tabId: tab.id, host, rule: siteRules[host] || {} };
}

function init(opts = {}) {
  // Restore last window state
  setChromeWindow(opts.window);
  create(opts);
}

module.exports = {
  init, create, close, setActive, navigate, reload, stop,
  goBack, goForward, getActiveTab, getAll, setChromeWindow,
  updateViewBounds, getStateForContentsId, broadcast,
};
