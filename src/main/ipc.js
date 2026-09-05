
'use strict';

const { ipcMain, shell, clipboard } = require('electron');
const config = require('./config');
const tabs = require('./tabs');
const history = require('./history');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const adblock = require('./adblock');
const { setLocale, getAvailable, t } = require('../shared/i18n');
const logger = require('./logger');

function register(win) {
  // ── Tabs ──────────────────────────────────────────────────────
  ipcMain.handle('tabs:getAll', () => tabs.getAll());
  ipcMain.handle('tabs:getActiveId', () => tabs.getActiveTab()?.id || null);
  ipcMain.handle('tabs:create', (e, opts) => {
    const tab = tabs.create(opts);
    return { id: tab.id };
  });
  ipcMain.handle('tabs:close', (e, id) => { tabs.close(id); });
  ipcMain.handle('tabs:setActive', (e, id) => { tabs.setActive(id); });
  ipcMain.handle('tabs:navigate', (e, id, url) => { tabs.navigate(id, url); });
  ipcMain.handle('tabs:reload', (e, id) => { tabs.reload(id); });
  ipcMain.handle('tabs:stop', (e, id) => { tabs.stop(id); });
  ipcMain.handle('tabs:goBack', (e, id) => { tabs.goBack(id); });
  ipcMain.handle('tabs:goForward', (e, id) => { tabs.goForward(id); });
  ipcMain.handle('tabs:getCurrentUrl', () => {
    const t = tabs.getActiveTab();
    return t ? { url: t.url, title: t.title } : { url: '', title: '' };
  });

  // ── Bookmarks ─────────────────────────────────────────────────
  ipcMain.handle('bookmarks:getAll', () => bookmarks.getAll());
  ipcMain.handle('bookmarks:add', (e, entry) => bookmarks.add(entry));
  ipcMain.handle('bookmarks:remove', (e, id) => { bookmarks.remove(id); });
  ipcMain.handle('bookmarks:getByUrl', (e, url) => bookmarks.getByUrl(url));

  // ── History ───────────────────────────────────────────────────
  ipcMain.handle('history:getRecent', (e, limit) => history.getRecent(limit));
  ipcMain.handle('history:search', (e, q, limit) => history.search(q, limit));
  ipcMain.handle('history:clear', () => { history.clear(); });

  // ── Downloads ─────────────────────────────────────────────────
  ipcMain.handle('downloads:getAll', () => downloads.getAll());
  ipcMain.handle('downloads:remove', (e, id) => { downloads.removeItem(id); });
  ipcMain.handle('downloads:clear', () => { downloads.clearAll(); });
  ipcMain.handle('downloads:openFolder', (e, p) => { downloads.openFolder(p); });
  ipcMain.handle('downloads:openFile', (e, p) => { downloads.openFile(p); });

  // ── Settings ──────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => {
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
  ipcMain.handle('settings:set', (e, key, value) => {
    config.set(key, value);
    if (key === 'adblock') adblock.reload();
    if (key === 'language') setLocale(value);
    return true;
  });

  // ── Per-site settings ─────────────────────────────────────────
  ipcMain.handle('site:getRule', (e, host) => {
    const rules = config.get().siteRules || {};
    return rules[host] || {};
  });
  ipcMain.handle('site:setRule', (e, host, rule) => {
    config.update((d) => {
      if (!d.siteRules) d.siteRules = {};
      d.siteRules[host] = rule;
    });
    // Apply to active tab if it matches this host
    const activeTab = tabs.getActiveTab();
    if (activeTab && activeTab.view) {
      let activeHost = '';
      try { activeHost = new URL(activeTab.url).hostname; } catch {}
      if (activeHost === host) {
        if (rule.javascript !== undefined) activeTab.view.webContents.setJavaScriptEnabled(rule.javascript !== false);
        if (rule.userAgent !== undefined) activeTab.view.webContents.setUserAgent(rule.userAgent || '');
      }
    }
    return true;
  });
  ipcMain.handle('site:deleteRule', (e, host) => {
    config.update((d) => {
      if (d.siteRules) delete d.siteRules[host];
    });
    return true;
  });
  ipcMain.handle('site:getAllRules', () => config.get().siteRules || {});
  ipcMain.handle('site:setPermission', (e, host, perm, enabled) => {
    config.update((d) => {
      if (!d.siteRules) d.siteRules = {};
      if (!d.siteRules[host]) d.siteRules[host] = {};
      if (!d.siteRules[host].permissions) d.siteRules[host].permissions = {};
      d.siteRules[host].permissions[perm] = enabled;
    });
    return true;
  });

  // ── Clipboard ─────────────────────────────────────────────────
  ipcMain.handle('clipboard:copy', (e, text) => { clipboard.writeText(text); return true; });

  // ── Window controls ───────────────────────────────────────────
  ipcMain.handle('window:minimize', () => { win.minimize(); });
  ipcMain.handle('window:maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', () => { win.close(); });
  ipcMain.handle('window:isMaximized', () => win.isMaximized());

  // ── i18n ──────────────────────────────────────────────────────
  ipcMain.handle('i18n:getAvailable', () => getAvailable());
  ipcMain.handle('i18n:setLocale', (e, loc) => { config.set('language', loc); setLocale(loc); return true; });

  // ── Adblock ───────────────────────────────────────────────────
  ipcMain.handle('adblock:getStats', () => adblock.stats());
  ipcMain.handle('adblock:isEnabled', () => adblock.isEnabled());

  // Listen for tab state changes and forward
  tabs.broadcast = function() {
    const allTabs = tabs.getAll();
    const activeId = tabs.getActiveTab()?.id || null;
    const activeTab = tabs.getActiveTab();
    const activeUrl = activeTab ? activeTab.url : '';
    const activeTitle = activeTab ? activeTab.title : '';
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('tabs:changed', allTabs, activeId, activeUrl, activeTitle);
    }
  };
}

module.exports = { register };
