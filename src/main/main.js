
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

// Security hardening
security.harden();

// Initialize services
downloadsManager.init();
adblockService.init();

// Create window when ready
app.whenReady().then(() => {
  const win = windowManager.create();
  downloadsManager.setWindow(win);
  ipcHandler.register(win);
  tabsManager.init({ window: win, url: cfg.homePage === 'start' ? '' : cfg.homePage });
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
