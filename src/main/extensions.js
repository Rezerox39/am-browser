'use strict';

const path = require('path');
const fs = require('fs');
const { app, session, BrowserWindow, protocol, WebContents } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, loadAllExtensions } = require('electron-chrome-web-store');
const { buildChromeContextMenu } = require('electron-chrome-context-menu');
const logger = require('./logger');
const extensionBridge = require('./extension-apis/bridge');
const tabs = require('./tabs');

let extensions = null;
let chromeWin = null;
let contextMenuEnabled = true;
let webStoreEnabled = true;
let installing = new Set();

/* ═══════════════════════════════════════════════════════════════
   POLYFILL: WebFrameMain.isDestroyed()
   Root cause of "sender frame.isDestroyed is not a function":
   electron-chrome-web-store v0.13 calls senderFrame.isDestroyed(),
   but WebFrameMain in Electron 31 does NOT have that method.
   Fix: polyfill it via WebContents.fromFrame() which IS supported.
   ═══════════════════════════════════════════════════════════════ */
function polyfillWebFrameMain() {
  try {
    const { WebFrameMain } = require('electron');
    if (WebFrameMain && WebFrameMain.prototype && typeof WebFrameMain.prototype.isDestroyed !== 'function') {
      WebFrameMain.prototype.isDestroyed = function () {
        try {
          const wc = WebContents.fromFrame(this);
          return !wc || wc.isDestroyed();
        } catch {
          return true;
        }
      };
      logger.info('extensions', 'Polyfilled WebFrameMain.isDestroyed() for Web Store compat');
    }
  } catch (e) {
    logger.warn('extensions', 'Could not polyfill WebFrameMain', { error: e.message });
  }
}

/* ═══════════════════════════════════════════════════════════════
   PERSISTENT EXTENSION DIRECTORY
   ═══════════════════════════════════════════════════════════════ */
const EXTENSIONS_DIR = path.join(app.getPath('userData'), 'extensions');
const REGISTRY_PATH = path.join(EXTENSIONS_DIR, 'registry.json');

function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    }
  } catch (e) {
    logger.warn('extensions', 'Registry load failed', { error: e.message });
  }
  return {};
}

function saveRegistry(reg) {
  try {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), 'utf8');
  } catch (e) {
    logger.warn('extensions', 'Registry save failed', { error: e.message });
  }
}

function ensureDirs() {
  try { fs.mkdirSync(EXTENSIONS_DIR, { recursive: true }); } catch {}
}

/* ═══════════════════════════════════════════════════════════════
   SCHEME REGISTRATION (must happen before app.ready)
   ═══════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════
   MAIN INIT
   ═══════════════════════════════════════════════════════════════ */
async function init(win) {
  chromeWin = win;
  const ses = session.defaultSession;

  // 1. Polyfill WebFrameMain before any library calls
  polyfillWebFrameMain();

  // 2. Register extension API bridge (chrome.storage, chrome.scripting, etc.)
  extensionBridge.register();

  // 3. Inject bridge preload into extension contexts
  injectBridgePreload(ses);

  // 4. UA override for site compatibility
  try {
    const ua = ses.getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}/\\S+`), '');
    ses.setUserAgent(ua);
  } catch (e) {
    logger.warn('extensions', 'UA override failed', { error: e.message });
  }

  const modulePath = resolveExtensionModulePath();

  // 5. Initialize ElectronChromeExtensions (tab/extension bridge)
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
      try { if (tab && tab.isDestroyed()) return } catch {}
      const rec = tabs.getStateForContentsId(tab.id);
      if (rec && rec.tabId) try { tabs.close(rec.tabId) } catch {}
    },
    createWindow: async (details) => {
      logger.warn('extensions', 'chrome.windows.create mapped to main window');
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

  // 6. Wire lifecycle callbacks
  tabs.setLifecycleCallbacks({
    onCreated(rec) {
      try {
        if (rec && rec._tab && rec._tab.webContents && !rec._tab.webContents.isDestroyed())
          extensions.addTab(rec._tab.webContents, chromeWin);
      } catch (e) { logger.warn('extensions', 'addTab failed', { error: e.message }); }
    },
    onSelected(rec) {
      try {
        if (rec && rec._tab && rec._tab.webContents && !rec._tab.webContents.isDestroyed())
          extensions.selectTab(rec._tab.webContents);
      } catch (e) { logger.warn('extensions', 'selectTab failed', { error: e.message }); }
    },
  });

  // 7. Sync pre-existing tabs
  try {
    for (const rec of tabs.getAll()) {
      const view = tabs.getTabView(rec.id);
      if (view && view.webContents) extensions.addTab(view.webContents, chromeWin);
    }
    const active = tabs.getActiveTab();
    if (active) {
      const view = tabs.getTabView(active.id);
      if (view && view.webContents) extensions.selectTab(view.webContents);
    }
  } catch (e) {
    logger.warn('extensions', 'Initial tab sync failed', { error: e.message });
  }

  // 8. Ensure extension directories exist
  ensureDirs();

  // 9. Load existing unpacked extensions from persistent directory (restart persistence)
  await loadPersistedExtensions(ses);

  // 10. Install Chrome Web Store support
  if (webStoreEnabled) {
    try {
      await installChromeWebStore({
        session: ses,
        async beforeInstall(details) {
          try {
            // Validate window and frame still alive
            const bw = details.browserWindow;
            if (!bw || bw.isDestroyed() || !chromeWin || chromeWin.isDestroyed()) {
              logger.warn('extensions', 'Web store install cancelled: window destroyed');
              return { action: 'deny' };
            }
            const permissions = (details.manifest && details.manifest.permissions) || [];
            logger.info('extensions', 'Web store install requested', {
              name: details.localizedName,
              id: details.id,
              permissions,
            });
            // Auto-allow for now (can add dialog later)
            return { action: 'allow' };
          } catch (e) {
            logger.warn('extensions', 'beforeInstall handler failed', { error: e.message });
            return { action: 'deny' };
          }
        },
      });
      logger.info('extensions', 'Chrome Web Store installer ready');
    } catch (e) {
      logger.warn('extensions', 'Web store init failed', { error: e.message });
    }
  }

  // 11. Record all extensions in persistent registry
  await syncRegistryWithSession(ses);

  // 12. Start MV3 service workers
  try {
    const all = ses.getAllExtensions();
    await Promise.all(all.map(async (ext) => {
      const manifest = ext.manifest;
      if (manifest && manifest.manifest_version === 3 &&
          manifest.background && manifest.background.service_worker) {
        await ses.serviceWorkers.startWorkerForScope(ext.url).catch((err) => {
          logger.warn('extensions', `Service worker start failed for ${ext.name}`, { error: err.message });
        });
      }
    }));
  } catch (e) {
    logger.warn('extensions', 'Service worker init failed', { error: e.message });
  }

  logger.info('extensions', 'Extensions support initialized');
  return extensions;
}

/* ═══════════════════════════════════════════════════════════════
   PERSISTENCE: Load persisted extensions on startup
   ═══════════════════════════════════════════════════════════════ */
async function loadPersistedExtensions(ses) {
  const registry = loadRegistry();
  for (const [extId, entry] of Object.entries(registry)) {
    if (entry.enabled === false) continue;
    if (!entry.path || !fs.existsSync(entry.path)) {
      logger.warn('extensions', `Extension ${extId} directory missing, skipping`);
      continue;
    }
    try {
      await ses.loadExtension(entry.path, { allowFileAccess: true });
      logger.info('extensions', `Loaded persisted extension: ${entry.name || extId}`);
    } catch (e) {
      logger.warn('extensions', `Failed to load persisted extension ${extId}: ${e.message}`);
    }
  }
}

async function syncRegistryWithSession(ses) {
  const registry = loadRegistry();
  const loaded = ses.getAllExtensions();
  const loadedIds = new Set(loaded.map(e => e.id));

  // Add newly installed extensions to registry (from Web Store or unpacked)
  for (const ext of loaded) {
    if (!registry[ext.id]) {
      registry[ext.id] = {
        name: ext.name,
        version: ext.version,
        path: ext.path,
        enabled: true,
        installDate: new Date().toISOString(),
      };
    } else {
      // Update metadata
      registry[ext.id].name = ext.name;
      registry[ext.id].version = ext.version;
      registry[ext.id].path = ext.path;
    }
  }

  // Mark removed extensions
  for (const [extId, entry] of Object.entries(registry)) {
    if (!loadedIds.has(extId)) {
      entry.enabled = false;
    }
  }

  saveRegistry(registry);
}

/* ═══════════════════════════════════════════════════════════════
   ENABLE / DISABLE / REMOVE
   ═══════════════════════════════════════════════════════════════ */
function enableExtension(extId) {
  try {
    const ses = session.defaultSession;
    const registry = loadRegistry();
    const entry = registry[extId];
    if (!entry || !entry.path || !fs.existsSync(entry.path)) {
      return { success: false, error: 'Extension not found or path invalid' };
    }
    // Check if already loaded
    const existing = ses.getAllExtensions().find(e => e.id === extId);
    if (existing) {
      entry.enabled = true;
      saveRegistry(registry);
      return { success: true };
    }
    // Load the extension
    ses.loadExtension(entry.path, { allowFileAccess: true }).then(() => {
      entry.enabled = true;
      saveRegistry(registry);
      logger.info('extensions', `Enabled extension: ${entry.name || extId}`);
    }).catch((e) => {
      logger.warn('extensions', `Failed to enable ${extId}: ${e.message}`);
    });
    entry.enabled = true;
    saveRegistry(registry);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function disableExtension(extId) {
  try {
    const ses = session.defaultSession;
    ses.removeExtension(extId);
    const registry = loadRegistry();
    if (registry[extId]) {
      registry[extId].enabled = false;
      saveRegistry(registry);
      logger.info('extensions', `Disabled extension: ${registry[extId].name || extId}`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function removeExtension(extId) {
  try {
    const ses = session.defaultSession;
    ses.removeExtension(extId);
    const registry = loadRegistry();
    if (registry[extId]) {
      const name = registry[extId].name || extId;
      // Remove files
      try {
        if (registry[extId].path && fs.existsSync(registry[extId].path)) {
          fs.rmSync(registry[extId].path, { recursive: true, force: true });
        }
      } catch (e) {
        logger.warn('extensions', `Failed to delete extension files: ${e.message}`);
      }
      delete registry[extId];
      saveRegistry(registry);
      logger.info('extensions', `Removed extension: ${name}`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function reloadExtension(extId) {
  try {
    const ses = session.defaultSession;
    // Remove first
    ses.removeExtension(extId);
    // Re-load from disk
    const registry = loadRegistry();
    const entry = registry[extId];
    if (!entry || !entry.path || !fs.existsSync(entry.path)) {
      return { success: false, error: 'Extension not found or path invalid' };
    }
    ses.loadExtension(entry.path, { allowFileAccess: true }).then(() => {
      logger.info('extensions', `Reloaded extension: ${entry.name || extId}`);
    }).catch((e) => {
      logger.warn('extensions', `Failed to reload ${extId}: ${e.message}`);
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* ═══════════════════════════════════════════════════════════════
   CONTEXT MENU
   ═══════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════
   BRIDGE PRELOAD INJECTION
   ═══════════════════════════════════════════════════════════════ */
function injectBridgePreload(ses) {
  const resolvedPath = require.resolve(path.join(__dirname, '..', 'preload', 'preload-extension-bridge.js'));
  app.on('web-contents-created', (event, wc) => {
    if (wc.session !== ses) return;
    wc.on('dom-ready', () => {
      if (wc.isDestroyed()) return;
      const url = wc.getURL();
      if (url && url.startsWith('chrome-extension://')) {
        const script = 'try{require(' + JSON.stringify(resolvedPath) + ')}catch(e){}';
        wc.executeJavaScript(script, true).catch(() => {});
      }
    });
  });
  logger.info('extension-bridge', 'Preload injection wired via web-contents-created');
}

/* ═══════════════════════════════════════════════════════════════
   QUERIES
   ═══════════════════════════════════════════════════════════════ */
function resolveExtensionModulePath() {
  try {
    return path.dirname(require.resolve('electron-chrome-extensions/package.json'));
  } catch { return ''; }
}

function getExtensionList() {
  try {
    const ses = session.defaultSession;
    if (!ses || typeof ses.getAllExtensions !== 'function') return [];
    const registry = loadRegistry();
    return ses.getAllExtensions().map((e) => ({
      id: e.id, name: e.name, version: e.version, url: e.url,
      enabled: registry[e.id]?.enabled !== false,
      path: e.path,
    }));
  } catch (e) {
    logger.warn('extensions', 'getExtensionList failed', { error: e.message });
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════ */
function setContextMenuEnabled(enabled) { contextMenuEnabled = enabled; }
function setWebStoreEnabled(enabled) { webStoreEnabled = enabled; }
function getExtensions() { return extensions; }
function getExtensionsDir() { return EXTENSIONS_DIR; }

module.exports = {
  announceSchemes, init, wireContextMenu, getExtensionList,
  setContextMenuEnabled, setWebStoreEnabled, getExtensions, getExtensionsDir,
  enableExtension, disableExtension, removeExtension, reloadExtension,
};
