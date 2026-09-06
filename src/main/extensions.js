'use strict';

const path = require('path');
const fs = require('fs');
const { app, session, BrowserWindow, protocol } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, loadAllExtensions } = require('electron-chrome-web-store');
const { buildChromeContextMenu } = require('electron-chrome-context-menu');
const logger = require('./logger');
const tabs = require('./tabs');

let extensions = null;
let chromeWin = null;
let contextMenuEnabled = true;
let webStoreEnabled = true;

// Root dirs
const ROOT_DIR = path.join(__dirname, '..', '..');
const EXTENSIONS_DIR = path.join(ROOT_DIR, 'extensions');

function resolveExtensionModulePath() {
  // Locate the electron-chrome-extensions package root. The library expects
  // `modulePath` to point at the package root and appends 'dist/preload.js'.
  try {
    return path.dirname(require.resolve('electron-chrome-extensions/package.json'));
  } catch {
    return '';
  }
}

function announceSchemes() {
  try {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'chrome-extension', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } },
      { scheme: 'crx', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: true } },
    ]);
  } catch (e) {
    logger.warn('extensions', 'Failed to register schemes', { error: e.message });
  }
}

async function init(win) {
  chromeWin = win;
  const ses = session.defaultSession;

  try {
    // Remove Electron/app details from the UA to improve site compatibility
    const ua = ses.getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}/\\S+`), '');
    ses.setUserAgent(ua);
  } catch (e) {
    logger.warn('extensions', 'UA override failed', { error: e.message });
  }

  const modulePath = resolveExtensionModulePath();

  extensions = new ElectronChromeExtensions({
    session: ses,
    modulePath,

    createTab: async (details) => {
      const record = tabs.create({ url: details.url || '' });
      const tabView = tabs.getTabView(record.id);
      if (!tabView || !tabView.webContents || tabView.webContents.isDestroyed()) throw new Error('Tab creation failed');
      return [tabView.webContents, chromeWin];
    },

    selectTab: (tab, browserWindow) => {
      const rec = tabs.getStateForContentsId(tab.id);
      if (rec && rec.tabId) tabs.setActive(rec.tabId);
    },

    removeTab: (tab, browserWindow) => {
      try {
        if (tab && tab.isDestroyed()) return
      } catch {}
      const rec = tabs.getStateForContentsId(tab.id);
      if (rec && rec.tabId) try { tabs.close(rec.tabId) } catch {}
    },

    createWindow: async (details) => {
      // Single-window browser: route new-window requests back to the main
      // window so extension installed windows behave predictably. Multi-window
      // support is documented as a future enhancement.
      logger.warn('extensions', 'chrome.windows.create mapped to main window (single-window browser)');
      return chromeWin;
    },

    removeWindow: (win) => {
      if (win && !win.isDestroyed() && win === chromeWin) {
        logger.warn('extensions', 'Ignoring chrome.windows.remove on the main window');
      } else if (win && !win.isDestroyed()) {
        win.destroy();
      }
    },
  });

  // Keep the extension system's internal tab store in sync with our tabs.
  tabs.setLifecycleCallbacks({
    onCreated(rec) {
      try {
        if (rec && rec._tab && rec._tab.webContents && !rec._tab.webContents.isDestroyed())
          extensions.addTab(rec._tab.webContents, chromeWin)
      } catch (e) { logger.warn('extensions', 'addTab failed', { error: e.message }) }
    },
    onSelected(rec) {
      try {
        if (rec && rec._tab && rec._tab.webContents && !rec._tab.webContents.isDestroyed())
          extensions.selectTab(rec._tab.webContents)
      } catch (e) { logger.warn('extensions', 'selectTab failed', { error: e.message }) }
    },
  });

  // Sync tabs that were created before the extension system initialized.
  try {
    for (const rec of tabs.getAll()) {
      const view = tabs.getTabView(rec.id)
      if (view && view.webContents) extensions.addTab(view.webContents, chromeWin)
    }
    const active = tabs.getActiveTab()
    if (active) {
      const view = tabs.getTabView(active.id)
      if (view && view.webContents) extensions.selectTab(view.webContents)
    }
  } catch (e) {
    logger.warn('extensions', 'Initial tab sync failed', { error: e.message })
  }

  // Load unpacked extensions dropped into ./extensions
  try {
    if (fs.existsSync(EXTENSIONS_DIR)) {
      await loadAllExtensions(ses, EXTENSIONS_DIR, { allowUnpacked: true });
      const installed = ses.getAllExtensions();
      logger.info('extensions', `Loaded ${installed.length} extension(s) from local directory`);
      for (const ext of installed) {
        logger.info('extensions', `  • ${ext.name} ${ext.version} (${ext.id})`);
      }
    } else {
      logger.info('extensions', 'No local extensions directory — creating it');
      try { fs.mkdirSync(EXTENSIONS_DIR, { recursive: true }); } catch {}
    }
  } catch (e) {
    logger.warn('extensions', 'Local extension load failed', { error: e.message });
  }

  // Chrome Web Store installer — lets users install store extensions.
  // In development the install prompt is auto-allowed and logged; this can be
  // swapped for a real confirmation dialog in production.
  try {
    if (webStoreEnabled) {
      await installChromeWebStore({
        session: ses,
        beforeInstall(details) {
          if (!details.browserWindow || details.browserWindow.isDestroyed()) return;
          const permissions = (details.manifest && details.manifest.permissions) || [];
          logger.info('extensions', 'Web store install requested', {
            name: details.localizedName, permissions,
          });
          return { action: 'allow' };
        },
      });
    }
  } catch (e) {
    logger.warn('extensions', 'Web store init failed', { error: e.message });
  }

  // Start MV3 service workers
  try {
    const all = ses.getAllExtensions();
    await Promise.all(all.map(async (extension) => {
      const manifest = extension.manifest;
      if (manifest && manifest.manifest_version === 3 &&
          manifest.background && manifest.background.service_worker) {
        await ses.serviceWorkers.startWorkerForScope(extension.url).catch((error) => {
          logger.warn('extensions', 'Service worker start failed', { error: error.message });
        });
      }
    }));
  } catch (e) {
    logger.warn('extensions', 'Service worker init failed', { error: e.message });
  }

  logger.info('extensions', 'Extensions support initialized');
  return extensions;
}

function wireContextMenu() {
  if (!extensions || !chromeWin) return;
  try {
    app.on('web-contents-created', (event, webContents) => {
      webContents.on('context-menu', (event, params) => {
        if (!contextMenuEnabled) return;
        try {
          const menu = buildChromeContextMenu({
            params,
            webContents,
            extensionMenuItems: extensions.getContextMenuItems(webContents, params),
            openLink: (url) => {
              const record = tabs.create({ url });
              if (record) tabs.navigate(record.id, url);
            },
          });
          if (menu && typeof menu.popup === 'function') menu.popup();
        } catch (e) {
          logger.warn('extensions', 'Context menu failed', { error: e.message });
        }
      });
    });
  } catch (e) {
    logger.warn('extensions', 'Context menu wiring failed', { error: e.message });
  }
}

function getExtensionList() {
  try {
    const ses = session.defaultSession;
    if (!ses || typeof ses.getAllExtensions !== 'function') return [];
    return ses.getAllExtensions().map((e) => ({
      id: e.id, name: e.name, version: e.version, url: e.url,
    }));
  } catch (e) {
    logger.warn('extensions', 'getExtensionList failed', { error: e.message });
    return [];
  }
}

function setContextMenuEnabled(enabled) { contextMenuEnabled = enabled; }
function setWebStoreEnabled(enabled) { webStoreEnabled = enabled; }
function getExtensions() { return extensions; }
function getExtensionsDir() { return EXTENSIONS_DIR; }

module.exports = {
  announceSchemes, init, wireContextMenu, getExtensionList,
  setContextMenuEnabled, setWebStoreEnabled, getExtensions, getExtensionsDir,
};
