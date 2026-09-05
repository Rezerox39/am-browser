
'use strict';

const { BrowserWindow, nativeTheme, screen } = require('electron');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const tabs = require('./tabs');

let mainWindow = null;

function create() {
  const cfg = config.get();
  const ws = cfg.windowState || {};

  const isWin11 = process.platform === 'win32';

  const winOpts = {
    width: ws.width || 1280,
    height: ws.height || 800,
    x: ws.x,
    y: ws.y,
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
    ...(isWin11 ? {
      backgroundMaterial: 'acrylic',
      transparent: true,
    } : {}),
  };

  mainWindow = new BrowserWindow(winOpts);

  // If transparency not supported, just use solid black bg
  if (isWin11) {
    try {
      mainWindow.setBackgroundColor('#000000');
    } catch {}
  }

  // Restore maximized state
  if (ws.maximized) {
    try { mainWindow.maximize(); } catch {}
  }

  // Track window state changes
  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    const cfg = config.get();
    cfg.windowState.width = w;
    cfg.windowState.height = h;
    cfg.windowState.maximized = mainWindow.isMaximized();
    config.scheduleSave();
    tabs.updateViewBounds();
  });
  mainWindow.on('move', () => {
    const [x, y] = mainWindow.getPosition();
    const cfg = config.get();
    cfg.windowState.x = x;
    cfg.windowState.y = y;
    config.scheduleSave();
  });
  mainWindow.on('maximize', () => {
    const cfg = config.get();
    cfg.windowState.maximized = true;
    config.scheduleSave();
    mainWindow.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    const cfg = config.get();
    cfg.windowState.maximized = false;
    config.scheduleSave();
    mainWindow.webContents.send('window:maximized', false);
  });

  // Load the chrome renderer
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((err) => {
    logger.error('window', 'Failed to load chrome', { error: err.message });
  });

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    logger.info('window', 'Main window ready');
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
