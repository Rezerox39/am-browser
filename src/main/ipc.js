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

function registerChannel(channel, fn) {
  try { ipcMain.removeHandler(channel); } catch {}
  ipcMain.handle(channel, fn);
}

function register(win) {
  // ── Tabs ──
  registerChannel('tabs:getAll', () => tabs.getAll());
  registerChannel('tabs:getActiveId', () => tabs.getActiveTab()?.id || null);
  registerChannel('tabs:getCurrentUrl', () => {
    const t = tabs.getActiveTab();
    return t ? { url: t.url, title: t.title } : { url: '', title: '' };
  });
  registerChannel('tabs:create', (e, opts) => { const tab = tabs.create(opts); return { id: tab.id }; });
  registerChannel('tabs:close', (e, id) => { tabs.close(id); });
  registerChannel('tabs:setActive', (e, id) => { tabs.setActive(id); });
  registerChannel('tabs:navigate', (e, id, url) => { tabs.navigate(id, url); });
  registerChannel('tabs:reload', (e, id) => { tabs.reload(id); });
  registerChannel('tabs:stop', (e, id) => { tabs.stop(id); });
  registerChannel('tabs:goBack', (e, id) => { tabs.goBack(id); });
  registerChannel('tabs:goForward', (e, id) => { tabs.goForward(id); });

  // ── View visibility / chrome overlay ──
  registerChannel('tabs:showHome', () => { tabs.showHome(); });
  registerChannel('tabs:hideContent', () => { tabs.hideActiveContent(); });
  registerChannel('tabs:showContent', () => { tabs.showActiveContent(); });

  // ── Bookmarks ──
  registerChannel('bookmarks:getAll', () => bookmarks.getAll());
  registerChannel('bookmarks:add', (e, entry) => bookmarks.add(entry));
  registerChannel('bookmarks:remove', (e, id) => bookmarks.remove(id));
  registerChannel('bookmarks:getByUrl', (e, url) => bookmarks.getByUrl(url));

  // ── History ──
  registerChannel('history:getRecent', (e, limit) => history.getRecent(limit));
  registerChannel('history:search', (e, q, limit) => history.search(q, limit));
  registerChannel('history:clear', () => { history.clear(); });

  // ── Downloads ──
  registerChannel('downloads:getAll', () => downloads.getAll());
  registerChannel('downloads:remove', (e, id) => downloads.removeItem(id));
  registerChannel('downloads:clear', () => downloads.clearAll());
  registerChannel('downloads:openFolder', (e, p) => downloads.openFolder(p));
  registerChannel('downloads:openFile', (e, p) => downloads.openFile(p));

  // ── Settings ──
  registerChannel('settings:get', () => {
    const cfg = config.get();
    return {
      language: cfg.language, theme: cfg.theme, adblock: cfg.adblock,
      homePage: cfg.homePage, searchEngine: cfg.searchEngine,
      askWhereToSave: cfg.askWhereToSave, blockPopups: cfg.blockPopups,
      defaultUserAgent: cfg.defaultUserAgent, siteRules: cfg.siteRules || {},
    };
  });
  registerChannel('settings:set', (e, key, value) => {
    config.set(key, value);
    if (key === 'adblock') adblock.reload();
    if (key === 'language') setLocale(value);
    return true;
  });

  // ── Per-site settings ──
  registerChannel('site:getRule', (e, host) => { const rules = config.get().siteRules || {}; return rules[host] || {}; });
  registerChannel('site:setRule', (e, host, rule) => {
    config.update((d) => { if (!d.siteRules) d.siteRules = {}; d.siteRules[host] = rule; });
    const activeTab = tabs.getActiveTab();
    const tabView = activeTab ? tabs.getTabView(activeTab.id) : null;
    if (tabView && tabView.webContents) {
      let activeHost = '';
      try { activeHost = new URL(activeTab.url).hostname; } catch {}
      if (activeHost === host) {
        if (rule.javascript === false) tabView.webContents.executeJavaScript('document.querySelectorAll("script").forEach(s=>s.remove())').catch(() => {});
        if (rule.userAgent) tabView.webContents.session.setUserAgent(rule.userAgent);
      }
    }
    return true;
  });
  registerChannel('site:getAllRules', () => config.get().siteRules || {});
  registerChannel('site:deleteRule', (e, host) => {
    config.update((d) => { if (d.siteRules) delete d.siteRules[host]; });
    return true;
  });
  registerChannel('site:setPermission', (e, host, perm, value) => {
    config.update((d) => {
      if (!d.siteRules) d.siteRules = {};
      if (!d.siteRules[host]) d.siteRules[host] = {};
      d.siteRules[host][perm] = value;
    });
    return true;
  });

  // ── Clipboard ──
  registerChannel('clipboard:copy', (e, text) => { clipboard.writeText(text); return true; });

  // ── Floating pill bridges ──
  registerChannel('ui:showHome', () => {
    try { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('ui:showHome'); } catch {}
  });
  registerChannel('ui:openMenu', () => {
    const { openMenuOverlay, closeMenuOverlay, isMenuOpen } = require('./tabs');
    if (isMenuOpen()) closeMenuOverlay(); else openMenuOverlay();
  });
  registerChannel('ui:closeMenu', () => {
    const { closeMenuOverlay } = require('./tabs');
    closeMenuOverlay();
  });
  registerChannel('ui:openExtensions', () => {
    const { openMenuOverlay } = require('./tabs');
    openMenuOverlay();
    // Send a signal to the menu view to navigate to extensions panel
    const mv = tabs.getMenuView();
    if (mv && mv.webContents && !mv.webContents.isDestroyed()) {
      setTimeout(() => {
        mv.webContents.send('menu:navigate', 'extensions');
      }, 350);
    }
  });
  registerChannel('ui:focusChrome', () => {
    try { if (!win.isDestroyed() && !win.webContents.isDestroyed()) { win.focus(); win.webContents.focus(); } } catch {}
  });

  // ── Window controls ──
  registerChannel('window:minimize', () => { try { if (!win.isDestroyed()) win.minimize(); } catch {} });
  registerChannel('window:maximize', () => {
    try { if (!win.isDestroyed()) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } } catch {}
  });
  registerChannel('window:close', () => { try { if (!win.isDestroyed()) win.close(); } catch {} });
  registerChannel('window:isMaximized', () => { try { return !win.isDestroyed() && win.isMaximized(); } catch { return false; } });

  // ── i18n ──
  registerChannel('i18n:getAvailable', () => getAvailable());
  registerChannel('i18n:getStrings', () => getStrings());
  registerChannel('i18n:setLocale', (e, loc) => { config.set('language', loc); setLocale(loc); return true; });

  // ── Adblock ──
  registerChannel('adblock:getStats', () => adblock.stats());
  registerChannel('adblock:isEnabled', () => adblock.isEnabled());

  // ── Extensions ──
  registerChannel('extensions:getAll', () => {
    return require('./extensions').getExtensionList();
  });
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
    try { const id = await extManager.installFromDir(dirPath); return { success: true, id }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  registerChannel('extensions:installZip', async (e, zipPath) => {
    const installer = require('./extensions/installer');
    try { const id = await installer.installFromZip(zipPath); return { success: true, id }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  registerChannel('extensions:uninstall', async (e, id) => {
    const extManager = require('./extensions/manager');
    try { await extManager.uninstall(id); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  registerChannel('extensions:enable', async (e, id) => {
    const extManager = require('./extensions/manager');
    try { await extManager.enable(id); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  registerChannel('extensions:disable', async (e, id) => {
    const extManager = require('./extensions/manager');
    try { await extManager.disable(id); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  registerChannel('extensions:reload', async (e, id) => {
    const extManager = require('./extensions/manager');
    try { await extManager.reload(id); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // ── Load unpacked (directory picker for dev mode) ──
  registerChannel('extensions:openDirPicker', async () => {
    const { dialog } = require('electron');
    const extManager = require('./extensions/manager');
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Extension Directory',
    });
    if (result.canceled || !result.filePaths.length) return { success: false, error: 'Cancelled' };
    try {
      const id = await extManager.installFromDir(result.filePaths[0]);
      return { success: true, id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Extension popup ──
  registerChannel('extensions:openPopup', (e, extensionId) => {
    const extManager = require('./extensions/manager');
    const info = extManager.getExtensionInfo(extensionId);
    if (!info || !info.manifest) return { success: false, error: 'Extension not found' };
    const action = info.manifest.action || {};
    const popup = action.default_popup;
    if (!popup) return { success: false, error: 'No popup defined' };

    const ext = require('electron').session.defaultSession.getExtension(extensionId);
    if (!ext) return { success: false, error: 'Extension not loaded' };

    const popupUrl = `chrome-extension://${extensionId}/${popup}`;
    // Position near the extensions button in the pill (center-bottom area)
    const [winW, winH] = win.getSize();
    tabs.openExtPopup({ extensionId, popupUrl, anchorX: winW / 2 + 30, anchorY: winH - 80 });
    return { success: true };
  });

  // ── Extension popup close (from preload) ──
  ipcMain.on('extensions:popupClose', () => {
    tabs.closeExtPopup();
  });

  // ── Extension permissions / manifest ──
  registerChannel('extensions:getPermissions', (e, id) => {
    const extManager = require('./extensions/manager');
    const info = extManager.getExtensionInfo(id);
    if (!info) return null;
    return {
      permissions: info.permissions || [],
      hostPermissions: info.hostPermissions || [],
    };
  });
  registerChannel('extensions:getManifest', (e, id) => {
    const extManager = require('./extensions/manager');
    const info = extManager.getExtensionInfo(id);
    if (!info || !info.manifest) return null;
    return info.manifest;
  });
  registerChannel('extensions:getErrors', (e, id) => {
    const extManager = require('./extensions/manager');
    return extManager.getExtensionErrors(id);
  });
}

module.exports = { register };
