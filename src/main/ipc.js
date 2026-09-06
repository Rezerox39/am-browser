'use strict';

const { ipcMain, clipboard } = require('electron');
const config = require('./config');
const tabs = require('./tabs');
const history = require('./history');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const adblock = require('./adblock');
const { setLocale, getAvailable, getStrings } = require('../shared/i18n');
const logger = require('./logger');

// Idempotent registration — macOS 'activate' can re-init a window, and
// registerChannel() throws if a channel is registered twice.
function registerChannel(channel, fn) {
  try { ipcMain.removeHandler(channel); } catch {}
  ipcMain.handle(channel, fn);
}

function register(win) {
  // ── Tabs ──────────────────────────────────────────────────────
  registerChannel('tabs:getAll', () => tabs.getAll());
  registerChannel('tabs:getActiveId', () => tabs.getActiveTab()?.id || null);
  registerChannel('tabs:getCurrentUrl', () => {
    const t = tabs.getActiveTab();
    return t ? { url: t.url, title: t.title } : { url: '', title: '' };
  });
  registerChannel('tabs:create', (e, opts) => {
    const tab = tabs.create(opts);
    return { id: tab.id };
  });
  registerChannel('tabs:close', (e, id) => { tabs.close(id); });
  registerChannel('tabs:setActive', (e, id) => { tabs.setActive(id); });
  registerChannel('tabs:navigate', (e, id, url) => { tabs.navigate(id, url); });
  registerChannel('tabs:reload', (e, id) => { tabs.reload(id); });
  registerChannel('tabs:stop', (e, id) => { tabs.stop(id); });
  registerChannel('tabs:goBack', (e, id) => { tabs.goBack(id); });
  registerChannel('tabs:goForward', (e, id) => { tabs.goForward(id); });

  // ── View visibility / chrome overlay ──────────────────────────
  registerChannel('tabs:showHome', () => { tabs.showHome(); });
  registerChannel('tabs:hideContent', () => { tabs.hideActiveContent(); });
  registerChannel('tabs:showContent', () => { tabs.showActiveContent(); });

  // ── Bookmarks ─────────────────────────────────────────────────
  registerChannel('bookmarks:getAll', () => bookmarks.getAll());
  registerChannel('bookmarks:add', (e, entry) => bookmarks.add(entry));
  registerChannel('bookmarks:remove', (e, id) => { bookmarks.remove(id); });
  registerChannel('bookmarks:getByUrl', (e, url) => bookmarks.getByUrl(url));

  // ── History ───────────────────────────────────────────────────
  registerChannel('history:getRecent', (e, limit) => history.getRecent(limit));
  registerChannel('history:search', (e, q, limit) => history.search(q, limit));
  registerChannel('history:clear', () => { history.clear(); });

  // ── Downloads ─────────────────────────────────────────────────
  registerChannel('downloads:getAll', () => downloads.getAll());
  registerChannel('downloads:remove', (e, id) => { downloads.removeItem(id); });
  registerChannel('downloads:clear', () => { downloads.clearAll(); });
  registerChannel('downloads:openFolder', (e, p) => { downloads.openFolder(p); });
  registerChannel('downloads:openFile', (e, p) => { downloads.openFile(p); });

  // ── Settings ──────────────────────────────────────────────────
  registerChannel('settings:get', () => {
    const cfg = config.get();
    return {
      language: cfg.language,
      theme: cfg.theme,
      adblock: cfg.adblock,
      homePage: cfg.homePage,
      searchEngine: cfg.searchEngine,
      askWhereToSave: cfg.askWhereToSave,
      blockPopups: cfg.blockPopups,
      defaultUserAgent: cfg.defaultUserAgent,
      siteRules: cfg.siteRules || {},
    };
  });
  registerChannel('settings:set', (e, key, value) => {
    config.set(key, value);
    if (key === 'adblock') adblock.reload();
    if (key === 'language') setLocale(value);
    return true;
  });

  // ── Per-site settings ─────────────────────────────────────────
  registerChannel('site:getRule', (e, host) => {
    const rules = config.get().siteRules || {};
    return rules[host] || {};
  });
  registerChannel('site:setRule', (e, host, rule) => {
    config.update((d) => {
      if (!d.siteRules) d.siteRules = {};
      d.siteRules[host] = rule;
    });
    // Apply immediately to the active tab if it matches this host
    const activeTab = tabs.getActiveTab();
    const tabView = activeTab ? tabs.getTabView(activeTab.id) : null;
    if (tabView && tabView.webContents) {
      let activeHost = '';
      try { activeHost = new URL(activeTab.url).hostname; } catch {}
      if (activeHost === host) {
        try { tabView.webContents.setJavaScriptEnabled(rule.javascript !== false); } catch {}
        if (rule.userAgent) { try { tabView.webContents.setUserAgent(rule.userAgent); } catch {} }
        try {
          if (rule.adblockEnabled !== undefined) adblock.setSiteAdblock(tabView.webContents.id, rule.adblockEnabled)
          else adblock.removeSite(tabView.webContents.id)
        } catch {}
      }
    }
    return true;
  });
  registerChannel('site:deleteRule', (e, host) => {
    config.update((d) => {
      if (d.siteRules) delete d.siteRules[host];
    });
    return true;
  });
  registerChannel('site:getAllRules', () => config.get().siteRules || {});
  registerChannel('site:setPermission', (e, host, perm, enabled) => {
    config.update((d) => {
      if (!d.siteRules) d.siteRules = {};
      if (!d.siteRules[host]) d.siteRules[host] = {};
      if (!d.siteRules[host].permissions) d.siteRules[host].permissions = {};
      d.siteRules[host].permissions[perm] = enabled;
    });
    return true;
  });

  // ── Clipboard ─────────────────────────────────────────────────
  registerChannel('clipboard:copy', (e, text) => { clipboard.writeText(text); return true; });

  // ── Floating pill bridges ─────────────────────────────────────
  // The pill overlay view forwards UI actions to the chrome window renderer.
  registerChannel('ui:showHome', () => {
    try { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('ui:showHome') } catch {}
  });
  registerChannel('ui:openMenu', () => {
    // Toggle the native WebContentsView menu overlay
    const { openMenuOverlay, closeMenuOverlay, isMenuOpen } = require('./tabs')
    if (isMenuOpen()) closeMenuOverlay(); else openMenuOverlay()
  });
  registerChannel('ui:closeMenu', () => {
    // Direct close — used by the menu overlay's own close buttons
    const { closeMenuOverlay } = require('./tabs')
    closeMenuOverlay()
  });
  registerChannel('ui:focusChrome', () => {
    try { if (!win.isDestroyed() && !win.webContents.isDestroyed()) { win.focus(); win.webContents.focus(); } } catch {}
  });

  // ── Window controls ───────────────────────────────────────────
  registerChannel('window:minimize', () => { try { if (!win.isDestroyed()) win.minimize() } catch {} });
  registerChannel('window:maximize', () => {
    try { if (!win.isDestroyed()) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } } catch {}
  });
  registerChannel('window:close', () => { try { if (!win.isDestroyed()) win.close() } catch {} });
  registerChannel('window:isMaximized', () => { try { return !win.isDestroyed() && win.isMaximized() } catch { return false } });

  // ── i18n ──────────────────────────────────────────────────────
  registerChannel('i18n:getAvailable', () => getAvailable());
  registerChannel('i18n:getStrings', () => getStrings());
  registerChannel('i18n:setLocale', (e, loc) => { config.set('language', loc); setLocale(loc); return true; });

  // ── Adblock ───────────────────────────────────────────────────
  registerChannel('adblock:getStats', () => adblock.stats());
  registerChannel('adblock:isEnabled', () => adblock.isEnabled());

  // ── Extensions ────────────────────────────────────────────────
  registerChannel('extensions:getAll', () => {
    return require('./extensions').getExtensionList();
  });
  // ── Extensions ────────────────────────────────────────────────
  registerChannel('extensions:list', () => {
    const extManager = require('./extensions/manager');
    return extManager.listExtensions();
  });
  registerChannel('extensions:getInfo', (e, id) => {
    const extManager = require('./extensions/manager');
    return extManager.getExtensionInfo(id);
  });
  registerChannel('extensions:install', async (e, dirPath) => {
    const extManager = require('./extensions/manager');
    try {
      const id = await extManager.installFromDir(dirPath);
      return { success: true, id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  registerChannel('extensions:installZip', async (e, zipPath) => {
    const installer = require('./extensions/installer');
    try {
      const id = await installer.installFromZip(zipPath);
      return { success: true, id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  registerChannel('extensions:uninstall', async (e, id) => {
    const extManager = require('./extensions/manager');
    try {
      await extManager.uninstall(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  registerChannel('extensions:enable', async (e, id) => {
    const extManager = require('./extensions/manager');
    try {
      await extManager.enable(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  registerChannel('extensions:disable', async (e, id) => {
    const extManager = require('./extensions/manager');
    try {
      await extManager.disable(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  registerChannel('extensions:reload', async (e, id) => {
    const extManager = require('./extensions/manager');
    try {
      await extManager.reload(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
