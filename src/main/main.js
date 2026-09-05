'use strict';

const { app, dialog } = require('electron');
const path = require('path');
const config = require('./config');
const windowManager = require('./window');
const security = require('./security');
const adblockService = require('./adblock');
const downloadsManager = require('./downloads');
const ipcHandler = require('./ipc');
const tabsManager = require('./tabs');
const logger = require('./logger');
const { setLocale } = require('../shared/i18n');

// Make errors VISIBLE — if anything fails before the window shows, the user sees a native dialog.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { logger.error('main', 'Uncaught exception', { error: err.message, stack: err.stack }); } catch {}
  try { dialog.showErrorBox('AM — Unexpected Error', err.message + '\n\n' + (err.stack || '')); } catch {}
  try { app.quit(); } catch {}
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  try { logger.error('main', 'Unhandled rejection', { reason: String(reason) }); } catch {}
});

// Single instance lock — but do NOT quit if we lose the lock (a previous crashed
// process might still hold it). Just proceed; the worst case is two AM windows.
let gotLock = false;
try { gotLock = app.requestSingleInstanceLock(); } catch {}

if (!gotLock) {
  // Best-effort focus of the existing instance, then continue anyway
  // (the existing instance may be a zombie from an earlier crash).
  logger.warn('main', 'Single instance lock not acquired — proceeding anyway');
}

app.on('second-instance', () => {
  windowManager.focus();
});

// Load config first
config.load();
const cfg = config.get();

// Set locale
setLocale(cfg.language || 'en');

// Set app identity
app.setName('AM');
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.am.browser'); } catch {}
}

// Everything that touches session.defaultSession MUST run after app is ready.
app.whenReady().then(() => {
  try {
    // Security hardening (accesses session.defaultSession)
    security.harden();

    // Initialize download manager (accesses session.defaultSession)
    downloadsManager.init();

    // Initialize ad-block (accesses session.defaultSession)
    adblockService.init();

    // Create main window
    const win = windowManager.create();
    downloadsManager.setWindow(win);
    ipcHandler.register(win);
    tabsManager.init({ window: win, url: cfg.homePage === 'start' ? '' : cfg.homePage });

    logger.info('main', 'App startup complete');
  } catch (err) {
    console.error('Startup error:', err);
    logger.error('main', 'Startup error', { error: err.message });
    dialog.showErrorBox('AM — Startup Error', 'Failed to start the browser:\n\n' + err.message);
    app.quit();
  }
});

// macOS: re-create window when dock icon clicked
app.on('activate', () => {
  if (!windowManager.getWindow()) {
    const win = windowManager.create();
    downloadsManager.setWindow(win);
    ipcHandler.register(win);
    tabsManager.init({ window: win });
  }
});

app.on('window-all-closed', () => {
  config.saveNow();
  app.quit();
});

// Graceful shutdown
process.on('SIGINT', () => { config.saveNow(); app.quit(); });
process.on('SIGTERM', () => { config.saveNow(); app.quit(); });
