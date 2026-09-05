'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

let mainWindow = null;

function create() {
  const cfg = config.get();
  const ws = cfg.windowState || {};

  // Determine safe dimensions (ensure on-screen)
  let x = ws.x, y = ws.y;
  const w = Math.min(ws.width || 1280, 3840);
  const h = Math.min(ws.height || 800, 2160);
  const primary = screen.getPrimaryDisplay().workAreaSize;
  if (x !== undefined && y !== undefined) {
    // Clamp to screen
    x = Math.max(0, Math.min(x, primary.width - 200));
    y = Math.max(0, Math.min(y, primary.height - 200));
  } else {
    x = Math.floor((primary.width - w) / 2);
    y = Math.floor((primary.height - h) / 2);
  }

  const baseOpts = {
    width: w,
    height: h,
    x, y,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  };

  // Try translucent window first (Windows 11 Mica/Acrylic)
  let usedTransparency = false;
  try {
    mainWindow = new BrowserWindow({
      ...baseOpts,
      transparent: true,
      backgroundMaterial: 'acrylic',
    });
    usedTransparency = true;
    logger.info('window', 'Created translucent window');
  } catch (e1) {
    logger.warn('window', 'Translucent window failed, falling back', { error: e1.message });
    try {
      mainWindow = new BrowserWindow({
        ...baseOpts,
        transparent: true,
      });
      usedTransparency = true;
      logger.info('window', 'Created transparent-only window');
    } catch (e2) {
      logger.warn('window', 'Transparent window failed too, using solid', { error: e2.message });
      mainWindow = new BrowserWindow(baseOpts);
      logger.info('window', 'Created solid window');
    }
  }

  // Restore maximized state
  if (ws.maximized) {
    try { mainWindow.maximize(); } catch {}
  }

  // Window state tracking
  mainWindow.on('resize', () => {
    try {
      const [w, h] = mainWindow.getSize();
      const cfg = config.get();
      cfg.windowState.width = w;
      cfg.windowState.height = h;
      cfg.windowState.maximized = mainWindow.isMaximized();
      config.scheduleSave();
      const tabs = require('./tabs');
      tabs.updateViewBounds();
    } catch {}
  });

  mainWindow.on('move', () => {
    try {
      const [x, y] = mainWindow.getPosition();
      const cfg = config.get();
      cfg.windowState.x = x;
      cfg.windowState.y = y;
      config.scheduleSave();
    } catch {}
  });

  mainWindow.on('maximize', () => {
    try {
      config.update((d) => { d.windowState.maximized = true; });
      mainWindow.webContents.send('window:maximized', true);
    } catch {}
  });

  mainWindow.on('unmaximize', () => {
    try {
      config.update((d) => { d.windowState.maximized = false; });
      mainWindow.webContents.send('window:maximized', false);
    } catch {}
  });

  // Log renderer errors
  mainWindow.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) logger.warn('renderer', msg);
  });

  // Load the chrome renderer
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(htmlPath).then(() => {
    logger.info('window', 'Chrome loaded successfully');
  }).catch((err) => {
    logger.error('window', 'Failed to load chrome', { error: err.message, path: htmlPath });
  });

  // Show when ready (with timeout fallback)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    logger.info('window', 'Main window shown');
  });

  // Fallback: if ready-to-show never fires (transparency issue), show after 3s
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      logger.warn('window', 'Fallback show — ready-to-show did not fire');
    }
  }, 3000);

  // Unrecoverable error handler
  mainWindow.on('render-process-gone', (e, details) => {
    logger.error('window', 'Render process crashed', { reason: details.reason });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getWindow() {
  return mainWindow;
}

function focus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

module.exports = { create, getWindow, focus };
