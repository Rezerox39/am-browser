
'use strict';

const { app, session } = require('electron');
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

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  windowManager.focus();
});

// Load config first
config.load();
const cfg = config.get();

// Set locale
setLocale(cfg.language || 'en');

// Set app identity (Windows taskbar)
app.setName('AM');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.am.browser');
}

// Catch all unhandled errors so the app never silently dies.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logger.error('main', 'Uncaught exception', { error: err.message, stack: err.stack });
});

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
  } catch (err) {
    console.error('Error during startup:', err);
    logger.error('main', 'Startup error', { error: err.message });
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
