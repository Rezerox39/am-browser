'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

let mainWindow = null;

function create() {
  const cfg = config.get();
  const ws = cfg.windowState || {};

  // Safe on-screen placement
  const w = Math.min(ws.width || 1280, 3840);
  const h = Math.min(ws.height || 800, 2160);
  const primary = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.max(0, Math.min(ws.x ?? Math.floor((primary.width - w) / 2), primary.width - 200));
  const y = Math.max(0, Math.min(ws.y ?? Math.floor((primary.height - h) / 2), primary.height - 200));

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

  // TRANSPARENCY IS OFF BY DEFAULT — solid black is guaranteed to render.
  // User can opt in via settings (transparency: true).
  const wantTransparency = !!cfg.transparency || process.env.AM_TRANSPARENT === '1';
  let usedTransparency = false;

  if (wantTransparency) {
    try {
      mainWindow = new BrowserWindow({ ...baseOpts, transparent: true, backgroundMaterial: 'acrylic' });
      usedTransparency = true;
      logger.info('window', 'Created translucent window');
    } catch (e1) {
      logger.warn('window', 'Translucent window failed, falling back to solid', { error: e1.message });
    }
  }
  if (!mainWindow) {
    mainWindow = new BrowserWindow(baseOpts);
    logger.info('window', 'Created solid black window (show = false, shown on ready-to-show)');
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
    try { config.update((d) => { d.windowState.maximized = true; }); mainWindow.webContents.send('window:maximized', true); } catch {}
  });
  mainWindow.on('unmaximize', () => {
    try { config.update((d) => { d.windowState.maximized = false; }); mainWindow.webContents.send('window:maximized', false); } catch {}
  });

  // Surface renderer errors in the log
  mainWindow.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) logger.warn('renderer', msg);
  });

  // Load chrome
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(htmlPath).then(() => {
    logger.info('window', 'Chrome loaded');
  }).catch((err) => {
    logger.error('window', 'Failed to load chrome', { error: err.message, path: htmlPath });
  });

  // Show on ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      logger.info('window', 'Main window shown');
    }
  });

  // Show immediately (no waiting) so the window is never silently missing.
  // paintWhenInitiallyHidden lets us load while hidden without GPU weirdness.
  mainWindow.on('show', () => logger.info('window', 'Window show event fired'));

  // Fallback: force-show after 2.5s no matter what
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      logger.warn('window', 'Fallback: forced show after 2.5s');
    }
  }, 2500);

  mainWindow.on('render-process-gone', (e, details) => {
    logger.error('window', 'Render process crashed', { reason: details.reason });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  return mainWindow;
}

function getWindow() { return mainWindow; }

function focus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

module.exports = { create, getWindow, focus };
