'use strict';

const { WebContentsView, screen } = require('electron');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');

const TOOLBAR_Y = 84;
const PADDING = 8;
let tabs = [];
let activeTabId = null;
let chromeWin = null;
let uiMode = 'home';
let pillView = null;
let _fullscreen = false;
let _contentHidden = false;
let menuView = null;
let menuOpen = false;
let extPopupView = null; // native WebContentsView for extension popups
let extPopupOpen = false;
const MENU_W = 340;
const MENU_MARGIN = 20;
const MENU_TRANSITION_MS = 280;
let menuSlideAnim = null;

const PILL = { width: 286, height: 56, bottom: 20 };
let lifecycle = { onCreated: () => {}, onSelected: () => {}, onDestroyed: () => {} };

function setChromeWindow(win) { chromeWin = win; }

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || tabs[0] || null;
}

function getAll() {
  return tabs.map((t) => ({
    id: t.id, url: t.url, title: t.title,
    favicon: t.favicon, loading: t.loading, isActive: t.id === activeTabId,
  }));
}

/* ── Tab class ── */
class Tab {
  constructor(parentWindow, opts = {}) {
    this.invalidateLayout = this.invalidateLayout.bind(this);
    const wcvOpts = { ...opts };
    if (wcvOpts.hasOwnProperty('webContents') && !wcvOpts.webContents) delete wcvOpts.webContents;
    if (wcvOpts.hasOwnProperty('webPreferences') && !wcvOpts.webPreferences) delete wcvOpts.webPreferences;

    this.view = new WebContentsView(wcvOpts);
    this.id = this.view.webContents.id;
    this.window = parentWindow;
    this.webContents = this.view.webContents;
    this._visible = false;
    this._destroyed = false;

    this.window.contentView.addChildView(this.view);
    this.view.setVisible(false);
    this.invalidateLayout();
    this.setupEvents();
  }

  setupEvents() {
    const wc = this.webContents;
    const alive = () => !this._destroyed && this.webContents && !this.webContents.isDestroyed();
    const safe = (fn) => () => { if (!alive()) return; try { fn() } catch (e) { logger.warn('tabs', 'event handler failed', { error: e.message }); } };

    wc.on('did-navigate', safe(() => {
      if (this._record) { this._record.url = wc.getURL(); history.add({ url: wc.getURL(), title: this._record.title || wc.getURL() }); }
      broadcast();
    }), { once: false });
    wc.on('did-navigate-in-page', safe(() => {
      if (this._record) { this._record.url = wc.getURL(); history.add({ url: wc.getURL(), title: this._record.title || wc.getURL() }); }
      broadcast();
    }));
    wc.on('page-title-updated', safe((e, title) => { if (this._record) this._record.title = title; broadcast(); }));
    wc.on('page-favicon-updated', safe((e, favicons) => { if (this._record && favicons && favicons.length > 0) this._record.favicon = favicons[0]; }));
    wc.on('did-start-loading', safe(() => { if (this._record) this._record.loading = true; broadcast(); }));
    wc.on('did-stop-loading', safe(() => { if (this._record) this._record.loading = false; broadcast(); }));
    wc.on('did-fail-load', safe((e, errorCode, errorDesc, validatedUrl) => {
      if (this._record) { this._record.loading = false; this._record.title = 'Error — ' + (errorDesc || errorCode); }
      logger.warn('tabs', 'Page failed to load', { url: validatedUrl, errorDesc });
      broadcast();
    }));

    wc.setWindowOpenHandler(({ url }) => {
      if (!url || url.startsWith('about:') || url.startsWith('javascript:')) return { action: 'deny' };
      const rec = create({ url });
      select(rec.id);
      return { action: 'deny' };
    });

    wc.on('before-input-event', (event, input) => forwardGlobalKey(input));
  }

  loadURL(url) { if (this.webContents && !this.webContents.isDestroyed()) this.webContents.loadURL(url).catch(() => {}); }
  show() { this._visible = true; try { this.view.setVisible(true); } catch {} this.invalidateLayout(); this.startResizeListener(); }
  hide() { this._visible = false; try { this.view.setVisible(false); } catch {} this.stopResizeListener(); }
  hideForOverlay() { this._hiddenForOverlay = true; this.stopResizeListener(); try { const [w, h] = this.window.getSize(); this.view.setBounds({ x: 0, y: h + 50, width: Math.max(200, w), height: 40 }); } catch {} this._visible = false; }
  showFromOverlay() { this._hiddenForOverlay = false; this._visible = true; this.invalidateLayout(); this.startResizeListener(); }
  reload() { this.webContents.reload(); }
  canGoBack() { return this.webContents.canGoBack(); }
  canGoForward() { return this.webContents.canGoForward(); }
  goBack() { if (this.webContents.canGoBack()) this.webContents.goBack(); }
  goForward() { if (this.webContents.canGoForward()) this.webContents.goForward(); }
  stop() { this.webContents.stop(); if (this._record) this._record.loading = false; broadcast(); }

  invalidateLayout() {
    const [width, height] = this.window.getSize();
    if (_fullscreen) { this.view.setBounds({ x: 0, y: 0, width, height }); return; }
    this.view.setBounds({ x: 0, y: TOOLBAR_Y, width: Math.max(200, width), height: Math.max(200, height - TOOLBAR_Y) });
  }

  startResizeListener() { this.stopResizeListener(); this.window.on('resize', this.invalidateLayout); }
  stopResizeListener() { this.window.off('resize', this.invalidateLayout); }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    try { this.stopResizeListener(); } catch {}
    try { if (this.view && this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view); } catch {}
    this.view = undefined;
    try { if (this.webContents && !this.webContents.isDestroyed()) this.webContents.destroy(); } catch {}
    this.webContents = undefined;
  }
}

/* ── Tab manager ── */
function create(opts = {}) {
  const tab = new Tab(chromeWin, {
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: true },
  });
  const record = { id: generateRecordId(), url: opts.url || '', title: opts.title || '', favicon: '', loading: false, _tab: tab };
  tab._record = record;
  tabs.push(record);
  try { lifecycle.onCreated(record); } catch (e) { logger.warn('tabs', 'onCreated hook failed', { error: e.message }); }
  if (opts.url) { tab.loadURL(opts.url); } else { record.title = 'New Tab'; }
  select(record.id);
  syncOverlayStack();
  broadcast();
  logger.info('tabs', 'Tab created', { id: record.id, url: record.url || '(blank)' });
  return record;
}

function generateRecordId() { return 'tab_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'); }
function getRecord(recordId) { return tabs.find((t) => t.id === recordId) || null; }
function getTabView(recordId) { const rec = getRecord(recordId); return rec ? rec._tab : null; }

function select(recordId) {
  const rec = getRecord(recordId);
  if (!rec) return;
  for (const t of tabs) { if (t._tab && t._tab._visible) t._tab.hide(); }
  activeTabId = recordId;
  if (rec._tab && rec.url) { if (!_contentHidden) rec._tab.show(); uiMode = 'content'; } else { uiMode = 'home'; }
  try { lifecycle.onSelected(rec); } catch (e) { logger.warn('tabs', 'onSelected hook failed', { error: e.message }); }
  broadcast();
}

function close(recordId) {
  const idx = tabs.findIndex((t) => t.id === recordId);
  if (idx === -1) return;
  const rec = tabs[idx];
  if (!rec || !rec._tab) { tabs.splice(idx, 1); return; }
  try { lifecycle.onDestroyed(rec); } catch {}
  rec._tab.destroy();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { create(); return; }
  if (activeTabId === recordId) { const next = tabs[Math.min(idx, tabs.length - 1)]; select(next.id); } else { broadcast(); }
  syncOverlayStack();
}

function setActive(recordId) { select(recordId); }

function navigate(recordId, url) {
  const rec = getRecord(recordId);
  const tabView = getTabView(recordId);
  if (!tabView) return;
  if (rec) rec.url = url;
  uiMode = 'content';
  select(recordId);
  tabView.loadURL(url);
}

function reload(recordId) { const rec = getRecord(recordId || activeTabId); if (rec) rec._tab.reload(); }
function stop(recordId) { const rec = getRecord(recordId || activeTabId); if (rec) rec._tab.stop(); }
function goBack(recordId) { const rec = getRecord(recordId || activeTabId); if (rec) rec._tab.goBack(); }
function goForward(recordId) { const rec = getRecord(recordId || activeTabId); if (rec) rec._tab.goForward(); }

/* ── Chrome helpers ── */
function showHome() { uiMode = 'home'; const active = getActiveTab(); if (active && active._tab) active._tab.hide(); broadcast(); }
function showContent() { const active = getActiveTab(); if (active && active._tab && active.url) { uiMode = 'content'; active._tab.show(); broadcast(); } }
function repositionActiveTab() { const active = getActiveTab(); if (active && active._tab) active._tab.invalidateLayout(); }
function hideActiveContent() { _contentHidden = true; const active = getActiveTab(); if (active && active._tab && active._tab._visible) active._tab.hideForOverlay(); }
function showActiveContent() { _contentHidden = false; const active = getActiveTab(); if (active && active._tab && active._tab._hiddenForOverlay) active._tab.showFromOverlay(); }
function isContentHidden() { return _contentHidden; }
function setLifecycleCallbacks(cb) { if (cb && typeof cb === 'object') lifecycle = { ...lifecycle, ...cb }; }

/* ── Local workArea ── */
function localWorkAreaHeight() {
  try {
    const [winX, winY] = chromeWin.getPosition();
    const [winW, winH] = chromeWin.getSize();
    const workArea = screen.getPrimaryDisplay().workArea;
    const winBottom = winY + winH;
    const workBottom = workArea.y + workArea.height;
    const overlap = Math.max(0, winBottom - workBottom);
    return winH - overlap;
  } catch { return chromeWin.getSize()[1]; }
}

/* ═══════════════════════════════════════════════════════════════
   OVERLAY STACK — single source of truth for native z-ordering
   ═══════════════════════════════════════════════════════════════
   Order (bottom → top):
     1. tab/content views   (managed via setVisible)
     2. menuView            (floating capsule, slides from right)
     3. extPopupView        (extension popup, when open)
     4. pillView            (floating nav bar, always topmost)
   ═══════════════════════════════════════════════════════════════ */
function syncOverlayStack() {
  if (!chromeWin || chromeWin.isDestroyed()) return;
  try {
    // 1. Menu above content
    if (menuView && !menuView.webContents.isDestroyed()) {
      chromeWin.contentView.addChildView(menuView);
    }
    // 2. Extension popup above menu
    if (extPopupView && !extPopupView.webContents.isDestroyed()) {
      chromeWin.contentView.addChildView(extPopupView);
    }
    // 3. Pill is always topmost
    if (pillView && !pillView.webContents.isDestroyed()) {
      chromeWin.contentView.addChildView(pillView);
      pillView.setVisible(true);
    }
  } catch (e) {
    logger.warn('tabs', 'syncOverlayStack failed', { error: e.message });
  }
}

/* ═══════════════════════════════════════════════════════════════
   MENU OVERLAY
   ═══════════════════════════════════════════════════════════════ */
function createMenuOverlay() {
  if (!chromeWin || chromeWin.isDestroyed() || menuView) return;
  try {
    menuView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload-menu.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, transparent: true,
      },
    });
    menuView.setBackgroundColor('#00000000');
    const [w] = chromeWin.getSize();
    const usableH = localWorkAreaHeight();
    menuView.setBounds({ x: w + 100, y: MENU_MARGIN, width: MENU_W, height: Math.max(200, usableH - MENU_MARGIN * 2) });
    chromeWin.contentView.addChildView(menuView);
    menuView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'menu.html')).catch((err) => {
      logger.warn('tabs', 'menu.html failed to load', { error: err.message });
    });
    logger.info('tabs', 'Menu overlay created');
  } catch (e) {
    logger.error('tabs', 'Failed to create menu overlay', { error: e.message });
    menuView = null;
  }
}

function openMenuOverlay() {
  if (menuOpen || !menuView || !chromeWin || chromeWin.isDestroyed()) return;
  menuOpen = true;
  closeExtPopup();
  syncOverlayStack();
  slideMenu(MENU_W);
}

function closeMenuOverlay() {
  if (!menuOpen) return;
  menuOpen = false;
  slideMenu(0);
}

function slideMenu(targetWidth, onComplete) {
  if (menuSlideAnim) { clearInterval(menuSlideAnim); menuSlideAnim = null; }
  const [winW] = chromeWin.getSize();
  const startX = menuView.getBounds().x;
  const targetX = targetWidth > 0 ? winW - targetWidth - MENU_MARGIN : winW + 100;
  const startTime = Date.now();

  menuSlideAnim = setInterval(() => {
    const t = Math.min(1, (Date.now() - startTime) / MENU_TRANSITION_MS);
    const ease = 1 - Math.pow(1 - t, 3);
    const x = Math.round(startX + (targetX - startX) * ease);
    const usableH = localWorkAreaHeight();
    try { menuView.setBounds({ x, y: MENU_MARGIN, width: MENU_W, height: Math.max(200, usableH - MENU_MARGIN * 2) }); } catch {}
    if (t >= 1) { clearInterval(menuSlideAnim); menuSlideAnim = null; if (onComplete) onComplete(); }
  }, 16);

  try { if (menuView && menuView.webContents && !menuView.webContents.isDestroyed()) menuView.webContents.send('menu:state', targetWidth > 0); } catch {}
}

function isMenuOpen() { return menuOpen; }

/* ═══════════════════════════════════════════════════════════════
   EXTENSION POPUP OVERLAY
   ═══════════════════════════════════════════════════════════════ */
const EXT_POPUP_DEFAULTS = { width: 360, height: 520 };
const EXT_POPUP_MIN = { width: 240, height: 100 };
const EXT_POPUP_MAX = { width: 500, height: 700 };
let extPopupAnim = null;
const EXT_POPUP_TRANSITION_MS = 220;

function openExtPopup(opts) {
  if (!chromeWin || chromeWin.isDestroyed()) return;
  // Close any existing popup first
  closeExtPopup();

  const { extensionId, popupUrl, anchorX, anchorY } = opts || {};
  if (!popupUrl) return;

  try {
    extPopupView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload-extension-popup.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    extPopupView.setBackgroundColor('#00000000');

    // Resolve popup dimensions from extension manifest
    const ses = require('electron').session.defaultSession;
    let extManifest = null;
    try { const ext = ses.getExtension(extensionId); if (ext) extManifest = ext.manifest; } catch {}
    const popupW = Math.max(EXT_POPUP_MIN.width, Math.min(EXT_POPUP_MAX.width, EXT_POPUP_DEFAULTS.width));
    const popupH = Math.max(EXT_POPUP_MIN.height, Math.min(EXT_POPUP_MAX.height, EXT_POPUP_DEFAULTS.height));

    // Position: anchor near the pill area (right side, near bottom)
    const [winW, winH] = chromeWin.getSize();
    const usableH = localWorkAreaHeight();
    const ax = typeof anchorX === 'number' ? anchorX : winW - 40;
    const ay = typeof anchorY === 'number' ? anchorY : usableH - PILL.bottom - PILL.height;

    // Clamp to window bounds
    const px = Math.max(MENU_MARGIN, Math.min(ax - popupW, winW - popupW - MENU_MARGIN));
    const py = Math.max(MENU_MARGIN, Math.min(ay - popupH, usableH - popupH - MENU_MARGIN));

    // Start off-screen above for slide-down animation
    extPopupView.setBounds({ x: px, y: py - 20, width: popupW, height: popupH });

    chromeWin.contentView.addChildView(extPopupView);
    syncOverlayStack();

    extPopupView.webContents.loadURL(popupUrl).catch((err) => {
      logger.warn('tabs', 'Extension popup load failed', { error: err.message });
    });

    extPopupOpen = true;

    // Slide down animation
    slideExtPopup({ x: px, y: py, width: popupW, height: popupH });

    // Listen for click outside to close
    chromeWin.webContents.on('before-input-event', extPopupDismissHandler);

    logger.info('tabs', 'Extension popup opened', { extensionId, popupUrl });
  } catch (e) {
    logger.error('tabs', 'Failed to open extension popup', { error: e.message });
    extPopupView = null;
    extPopupOpen = false;
  }
}

function extPopupDismissHandler(event, input) {
  if (!extPopupOpen) return;
  if (input.type === 'keyDown' && (input.key === 'Escape' || input.key === 'Esc')) {
    closeExtPopup();
  }
}

function closeExtPopup() {
  if (!extPopupView || !extPopupOpen) return;
  try { chromeWin.webContents.removeListener('before-input-event', extPopupDismissHandler); } catch {}

  const targetY = extPopupView.getBounds().y - 20;
  slideExtPopup({ ...extPopupView.getBounds(), y: targetY }, () => {
    try { chromeWin.contentView.removeChildView(extPopupView); } catch {}
    try { extPopupView.webContents.destroy(); } catch {}
    extPopupView = null;
    extPopupOpen = false;
    syncOverlayStack();
  });
}

function slideExtPopup(targetBounds, onComplete) {
  if (extPopupAnim) { clearInterval(extPopupAnim); extPopupAnim = null; }
  const startBounds = extPopupView.getBounds();
  const startTime = Date.now();

  extPopupAnim = setInterval(() => {
    const t = Math.min(1, (Date.now() - startTime) / EXT_POPUP_TRANSITION_MS);
    const ease = 1 - Math.pow(1 - t, 3);
    try {
      extPopupView.setBounds({
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * ease),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * ease),
        width: targetBounds.width,
        height: targetBounds.height,
      });
    } catch {}
    if (t >= 1) { clearInterval(extPopupAnim); extPopupAnim = null; if (onComplete) onComplete(); }
  }, 16);
}

function isExtPopupOpen() { return extPopupOpen; }

/* ═══════════════════════════════════════════════════════════════
   FLOATING NAV PILL
   ═══════════════════════════════════════════════════════════════ */
function createPillOverlay() {
  if (!chromeWin || chromeWin.isDestroyed()) return;
  try {
    pillView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload-pill.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, transparent: true,
      },
    });
    pillView.setBackgroundColor('#00000000');
    pillView.setVisible(false);
    chromeWin.contentView.addChildView(pillView);
    layoutPill();
    pillView.webContents.on('before-input-event', (event, input) => forwardGlobalKey(input));
    pillView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'pill.html')).catch((err) => {
      logger.warn('tabs', 'pill.html failed to load', { error: err.message });
    });
    pillView.setVisible(true);
    logger.info('tabs', 'Floating nav pill overlay created');
  } catch (e) {
    logger.error('tabs', 'Failed to create pill overlay', { error: e.message });
    pillView = null;
  }
}

function layoutPill() {
  if (!pillView || !chromeWin || chromeWin.isDestroyed()) return;
  const [w] = chromeWin.getSize();
  const usableH = localWorkAreaHeight();
  try {
    pillView.setBounds({
      x: Math.max(8, Math.round((w - PILL.width) / 2)),
      y: Math.max(TOOLBAR_Y + 8, usableH - PILL.height - PILL.bottom),
      width: PILL.width,
      height: PILL.height,
    });
  } catch (e) { logger.warn('tabs', 'layoutPill failed', { error: e.message }); }
}

/* ── Broadcast ── */
function broadcast() {
  if (!chromeWin || chromeWin.isDestroyed()) return;
  let chromeOK = false;
  try { chromeOK = !chromeWin.webContents.isDestroyed(); } catch { return; }
  if (!chromeOK) return;
  const active = getActiveTab();
  let canBack = false, canFwd = false;
  const view = active && active._tab ? active._tab : null;
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    try { canBack = view.webContents.canGoBack(); canFwd = view.webContents.canGoForward(); } catch {}
  }
  const args = [getAll(), active?.id || null, active?.url || '', active?.title || '', uiMode, canBack, canFwd];
  try { if (!chromeWin.webContents.isDestroyed()) chromeWin.webContents.send('tabs:changed', ...args); } catch {}
  if (pillView && pillView.webContents && !pillView.webContents.isDestroyed()) {
    try { pillView.webContents.send('tabs:changed', ...args); } catch {}
  }
}

function forwardGlobalKey(input) {
  if (!input || input.type !== 'keyDown') return;
  if (input.key === 'Escape' || input.key === 'Esc') {
    if (extPopupOpen) closeExtPopup();
    else if (menuOpen) closeMenuOverlay();
  }
}

function getStateForContentsId(wcId) {
  const rec = tabs.find((t) => t._tab && t._tab.webContents && t._tab.webContents.id === wcId);
  if (!rec) return {};
  let host = '';
  try { host = new URL(rec.url).hostname; } catch {}
  const rule = (config.get().siteRules || {})[host] || {};
  return { tabId: rec.id, host, rule };
}

function init(opts = {}) {
  setChromeWindow(opts.window);
  createMenuOverlay();
  createPillOverlay();
  create(opts);
  wireFullscreen();
}

/* ── Fullscreen ── */
function wireFullscreen() {
  if (!chromeWin || chromeWin.isDestroyed()) return;
  chromeWin.webContents.on('enter-html-full-screen', () => enterFullscreen());
  chromeWin.webContents.on('leave-html-full-screen', () => leaveFullscreen());
}
function enterFullscreen() {
  if (_fullscreen) return;
  _fullscreen = true;
  try { if (!chromeWin.isDestroyed()) chromeWin.setFullScreen(true); } catch {}
  try { chromeWin.webContents.send('ui:fullscreen', true); } catch {}
  try { if (pillView && !pillView.webContents.isDestroyed()) pillView.setVisible(false); } catch {}
  try { if (extPopupView && !extPopupView.webContents.isDestroyed()) extPopupView.setVisible(false); } catch {}
  repositionActiveTab();
}
function leaveFullscreen() {
  if (!_fullscreen) return;
  _fullscreen = false;
  try { if (!chromeWin.isDestroyed()) chromeWin.setFullScreen(false); } catch {}
  try { chromeWin.webContents.send('ui:fullscreen', false); } catch {}
  try { if (pillView && !pillView.webContents.isDestroyed()) pillView.setVisible(true); } catch {}
  try { if (extPopupView && !extPopupView.webContents.isDestroyed()) extPopupView.setVisible(true); } catch {}
  repositionActiveTab();
}
function isFullscreen() { return _fullscreen; }

module.exports = {
  init, create, close, setActive, navigate, reload, stop,
  goBack, goForward, getActiveTab, getAll, getRecord, getTabView,
  setChromeWindow, getStateForContentsId, broadcast,
  showHome, showContent, repositionActiveTab, layoutChrome,
  setLifecycleCallbacks, getPillView, getMenuView, isFullscreen, enterFullscreen, leaveFullscreen,
  hideActiveContent, showActiveContent, isContentHidden,
  openMenuOverlay, closeMenuOverlay, isMenuOpen,
  openExtPopup, closeExtPopup, isExtPopupOpen,
  syncOverlayStack, PILL,
};

function getPillView() { return pillView; }
function getMenuView() { return menuView; }

function layoutChrome() {
  repositionActiveTab();
  layoutPill();
  syncOverlayStack();
}
