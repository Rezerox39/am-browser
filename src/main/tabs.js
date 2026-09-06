'use strict';

const { WebContentsView } = require('electron');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const history = require('./history');

// Chrome heights (must match CSS): tab strip ~52px + url bar ~32px + margins.
// The view lives BELOW all chrome so it never covers clickable UI.
const TOOLBAR_Y = 84;   // vertical offset where the content view starts
const PADDING = 8;      // side/bottom padding
let tabs = [];
let activeTabId = null;
let chromeWin = null;
let uiMode = 'home'; // 'home' | 'content' — what the chrome UI is showing
// rightInset removed — menu/panel are overlays (content view hidden during overlay)
let pillView = null; // transparent floating nav pill overlay (topmost layer)
let _fullscreen = false;
let _contentHidden = false; // true when menu/panel overlay is covering content
let menuView = null; // native WebContentsView for the slide-in menu/panel overlay
let menuOpen = false;
const MENU_W = 340;
const PANEL_W = 420;
const MENU_TRANSITION_MS = 280;
let menuSlideAnim = null;

// The floating pill is its own transparent WebContentsView added AFTER every
// content view, so it always paints on top of the page (Electron composites
// contentView children client-side). It stays put while the page scrolls
// underneath it.
const PILL = {
  width: 246,
  height: 56,
  bottom: 20,
};
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

/* ── Tab class: WebContentsView stays attached, toggled with setVisible ── */
class Tab {
  constructor(parentWindow, opts = {}) {
    this.invalidateLayout = this.invalidateLayout.bind(this)

    const wcvOpts = { ...opts }
    if (wcvOpts.hasOwnProperty('webContents') && !wcvOpts.webContents) delete wcvOpts.webContents
    if (wcvOpts.hasOwnProperty('webPreferences') && !wcvOpts.webPreferences) delete wcvOpts.webPreferences

    this.view = new WebContentsView(wcvOpts)
    this.id = this.view.webContents.id
    this.window = parentWindow
    this.webContents = this.view.webContents
    this._visible = false
    this._destroyed = false

    // Attach ONCE — never remove from contentView. Visibility is toggled with
    // setVisible(), following the electron-browser-shell architecture, so the
    // chrome DOM (tab strip, toolbar, panels) is never blocked by the view.
    this.window.contentView.addChildView(this.view)
    this.view.setVisible(false)
    this.invalidateLayout()

    this.setupEvents()
  }

  setupEvents() {
    const wc = this.webContents
    const alive = () => !this._destroyed && this.webContents && !this.webContents.isDestroyed()

    // Any event that can fire on a webContents AFTER destroy() (Electron queues
    // these) must not touch destroyed objects — that was the Windows
    // "Object has been destroyed" crash in broadcast().
    const safe = (fn) => () => { if (!alive()) return; try { fn() } catch (e) { logger.warn('tabs', 'event handler failed', { error: e.message }) } }

    wc.on('did-navigate', safe(() => {
      if (this._record) {
        this._record.url = wc.getURL()
        history.add({ url: wc.getURL(), title: this._record.title || wc.getURL() })
      }
      broadcast()
    }), { once: false })
    wc.on('did-navigate-in-page', safe(() => {
      if (this._record) {
        this._record.url = wc.getURL()
        history.add({ url: wc.getURL(), title: this._record.title || wc.getURL() })
      }
      broadcast()
    }))
    wc.on('page-title-updated', safe((e, title) => {
      if (this._record) this._record.title = title
      broadcast()
    }))
    wc.on('page-favicon-updated', safe((e, favicons) => {
      if (this._record && favicons && favicons.length > 0) this._record.favicon = favicons[0]
    }))
    wc.on('did-start-loading', safe(() => {
      if (this._record) this._record.loading = true
      broadcast()
    }))
    wc.on('did-stop-loading', safe(() => {
      if (this._record) this._record.loading = false
      broadcast()
    }))
    wc.on('did-fail-load', safe((e, errorCode, errorDesc, validatedUrl) => {
      if (this._record) {
        this._record.loading = false
        this._record.title = 'Error — ' + (errorDesc || errorCode)
      }
      logger.warn('tabs', 'Page failed to load', { url: validatedUrl, errorDesc })
      broadcast()
    }))

    wc.setWindowOpenHandler(({ url }) => {
      if (!url || url.startsWith('about:') || url.startsWith('javascript:')) return { action: 'deny' }
      const rec = create({ url })
      select(rec.id)
      return { action: 'deny' }
    })

    wc.on('before-input-event', (event, input) => {
      forwardGlobalKey(input)
      const mods = input.control || input.meta
      if (!mods) return
      if (input.key === 't') {
        event.preventDefault()
        create()
      } else if (input.key === 'w') {
        event.preventDefault()
        if (this._record) close(this._record.id)
      } else if (input.key === 'l') {
        event.preventDefault()
        if (chromeWin && !chromeWin.webContents.isDestroyed()) {
          chromeWin.webContents.send('tabs:focusAddressBar')
        }
      } else if (input.key === 'r' && !input.shift) {
        event.preventDefault()
        if (this._record) reload(this._record.id)
      } else if (input.key === 'd') {
        event.preventDefault()
        const bookmarks = require('./bookmarks')
        const existing = bookmarks.getByUrl(this._record ? this._record.url : '')
        if (existing) bookmarks.remove(existing.id)
        else bookmarks.add({ url: this._record.url, title: this._record.title, favicon: this._record.favicon })
        broadcast()
      }
    })
  }

  loadURL(url) {
    if (this._record) {
      this._record.url = url
      this._record.loading = true
    }
    // Apply per-site settings
    let host = ''
    try { host = new URL(url).hostname } catch {}
    const rule = (config.get().siteRules || {})[host] || {}
    try { this.webContents.setJavaScriptEnabled(rule.javascript !== false); } catch {}
    if (rule.userAgent) {
      try { this.webContents.setUserAgent(rule.userAgent); } catch {}
    } // else keep the session default UA
    // Per-site adblock override (falls back to the global default otherwise)
    try {
      const adblock = require('./adblock')
      if (rule.adblockEnabled !== undefined) adblock.setSiteAdblock(this.webContents.id, rule.adblockEnabled)
      else adblock.removeSite(this.webContents.id)
    } catch {}

    broadcast()
    return this.webContents.loadURL(url).catch((err) => {
      logger.warn('tabs', 'loadURL failed', { url, error: err.message })
    })
  }

  show() {
    this.invalidateLayout()
    this.startResizeListener()
    this.view.setVisible(true)
    this._visible = true
  }

  hide() {
    this.stopResizeListener()
    this.view.setVisible(false)
    this._visible = false
  }

  // Overlay-safe hide: keep the GPU surface alive by moving off-screen instead
  // of setVisible(false).  This avoids the black repaint on Windows.
  hideForOverlay() {
    this._hiddenForOverlay = true
    this.stopResizeListener()
    try {
      const [w, h] = this.window.getSize()
      this.view.setBounds({ x: 0, y: h + 50, width: Math.max(200, w), height: 40 })
    } catch {}
    this._visible = false
  }
  showFromOverlay() {
    this._hiddenForOverlay = false
    this._visible = true
    this.invalidateLayout()
    this.startResizeListener()
  }

  reload() {
    this.webContents.reload()
  }

  canGoBack() {
    return this.webContents.canGoBack()
  }

  canGoForward() {
    return this.webContents.canGoForward()
  }

  goBack() {
    if (this.webContents.canGoBack()) this.webContents.goBack()
  }

  goForward() {
    if (this.webContents.canGoForward()) this.webContents.goForward()
  }

  stop() {
    this.webContents.stop()
    if (this._record) this._record.loading = false
    broadcast()
  }

  invalidateLayout() {
    const [width, height] = this.window.getSize()
    // In fullscreen the content view covers the entire window; chrome and pill
    // are hidden so the video can use the full screen real estate.
    if (_fullscreen) {
      this.view.setBounds({ x: 0, y: 0, width, height })
      return
    }
    // Normal mode: full-bleed below the top chrome (tab strip + url bar).
    this.view.setBounds({
      x: 0,
      y: TOOLBAR_Y,
      width: Math.max(200, width),
      height: Math.max(200, height - TOOLBAR_Y),
    })
  }

  startResizeListener() {
    this.stopResizeListener()
    this.window.on('resize', this.invalidateLayout)
  }
  stopResizeListener() {
    this.window.off('resize', this.invalidateLayout)
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    try { this.stopResizeListener() } catch {}
    try { if (this.view && this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view) } catch {}
    this.view = undefined
    try { if (this.webContents && !this.webContents.isDestroyed()) this.webContents.destroy() } catch {}
    this.webContents = undefined
  }
}

/* ── Tab manager ───────────────────────────────────────────── */
function create(opts = {}) {
  const tab = new Tab(chromeWin, {
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  })

  const record = {
    id: generateRecordId(),
    url: opts.url || '',
    title: opts.title || '',
    favicon: '',
    loading: false,
    _tab: tab,
  }
  tab._record = record
  tabs.push(record)

  // Notify the extension manager BEFORE the view loads anything so content
  // scripts can be injected into this tab.
  try { lifecycle.onCreated(record) } catch (e) { logger.warn('tabs', 'onCreated hook failed', { error: e.message }) }

  if (opts.url) {
    tab.loadURL(opts.url)
  } else {
    record.title = 'New Tab'
  }

  select(record.id)
  ensurePillTop()
  broadcast()
  logger.info('tabs', 'Tab created', { id: record.id, url: record.url || '(blank)' })
  return record
}

function generateRecordId() {
  return 'tab_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex')
}

function getRecord(recordId) {
  return tabs.find((t) => t.id === recordId) || null
}

function getTabView(recordId) {
  const rec = getRecord(recordId)
  return rec ? rec._tab : null
}

function select(recordId) {
  const rec = getRecord(recordId)
  if (!rec) return

  // Hide all views, then show the selected one
  for (const t of tabs) {
    if (t._tab && t._tab._visible) t._tab.hide()
  }

  activeTabId = recordId

  // Only show the view if there's a URL (so home stays clear) and no overlay
  if (rec._tab && rec.url) {
    if (!_contentHidden) rec._tab.show()
    uiMode = 'content'
  } else {
    uiMode = 'home'
  }

  try { lifecycle.onSelected(rec) } catch (e) { logger.warn('tabs', 'onSelected hook failed', { error: e.message }) }

  broadcast()
}

function close(recordId) {
  const idx = tabs.findIndex((t) => t.id === recordId)
  if (idx === -1) return
  const rec = tabs[idx]
  if (!rec || !rec._tab) { tabs.splice(idx, 1); return }
  try { lifecycle.onDestroyed(rec) } catch {}
  rec._tab.destroy()
  tabs.splice(idx, 1)
  if (tabs.length === 0) {
    create()
    return
  }
  if (activeTabId === recordId) {
    const next = tabs[Math.min(idx, tabs.length - 1)]
    select(next.id)
  } else {
    broadcast()
  }
  ensurePillTop()
}

function setActive(recordId) {
  select(recordId)
}

function navigate(recordId, url) {
  const rec = getRecord(recordId)
  const tabView = getTabView(recordId)
  if (!tabView) return
  // Set URL BEFORE select() so the view actually shows
  if (rec) rec.url = url
  uiMode = 'content'
  select(recordId)
  tabView.loadURL(url)
}

function reload(recordId) {
  const rec = getRecord(recordId || activeTabId)
  if (rec) rec._tab.reload()
}

function stop(recordId) {
  const rec = getRecord(recordId || activeTabId)
  if (rec) rec._tab.stop()
}

function goBack(recordId) {
  const rec = getRecord(recordId || activeTabId)
  if (rec) rec._tab.goBack()
}

function goForward(recordId) {
  const rec = getRecord(recordId || activeTabId)
  if (rec) rec._tab.goForward()
}

/* ── Public chrome helpers (renderer lives in the chrome window) ── */
function showHome() {
  uiMode = 'home'
  const active = getActiveTab()
  if (active && active._tab) active._tab.hide()
  broadcast()
}
function showContent() {
  const active = getActiveTab()
  if (active && active._tab && active.url) {
    uiMode = 'content'
    active._tab.show()
    broadcast()
  }
}
function repositionActiveTab() {
  const active = getActiveTab()
  if (active && active._tab) active._tab.invalidateLayout()
}
function hideActiveContent() {
  _contentHidden = true
  const active = getActiveTab()
  if (active && active._tab && active._tab._visible) active._tab.hideForOverlay()
}
function showActiveContent() {
  _contentHidden = false
  const active = getActiveTab()
  if (active && active._tab && active._tab._hiddenForOverlay) {
    active._tab.showFromOverlay()
  }
}
function isContentHidden() { return _contentHidden }
function setLifecycleCallbacks(cb) {
  if (cb && typeof cb === 'object') lifecycle = { ...lifecycle, ...cb }
}


/* ── Menu overlay (WebContentsView) ─────────────────────────── */
// The menu sits above content views and below the pill. It renders the
// slide-in side menu and settings panels via its own HTML/JS, just like
// the pill renders the nav bar.
function createMenuOverlay() {
  if (!chromeWin || chromeWin.isDestroyed() || menuView) return
  try {
    menuView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload-menu.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        transparent: true,
      },
    })
    menuView.setBackgroundColor('#00000000')
    // Position off-screen initially (right side)
    const [w, h] = chromeWin.getSize()
    menuView.setBounds({ x: w + 100, y: 0, width: MENU_W, height: h })
    // Add BEFORE the pill so the pill stays on top
    chromeWin.contentView.addChildView(menuView)
    menuView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'menu.html')).catch((err) => {
      logger.warn('tabs', 'menu.html failed to load', { error: err.message })
    })
    logger.info('tabs', 'Menu overlay created')
  } catch (e) {
    logger.error('tabs', 'Failed to create menu overlay', { error: e.message })
    menuView = null
  }
}

// Re-adding an already-attached child moves it to the END of the view stack,
// i.e. the TOPMOST paint/input layer. The menu is added once at creation, but
// tab/search views can be added or re-added later, which reshuffles native
// stacking. This helper restores the guaranteed order every time:
//   content/page views  (bottom)
//   menuView
//   pillView            (topmost)
function ensureMenuAboveContent() {
  if (!chromeWin || chromeWin.isDestroyed() || !menuView) return

  try {
    chromeWin.contentView.addChildView(menuView)

    // Keep the pill above the menu.
    if (pillView && !pillView.webContents.isDestroyed()) {
      chromeWin.contentView.addChildView(pillView)
    }
  } catch (e) {
    logger.warn('tabs', 'Failed to restore overlay stack', {
      error: e.message,
    })
  }
}

function openMenuOverlay() {
  if (menuOpen || !menuView || !chromeWin || chromeWin.isDestroyed()) return

  menuOpen = true
  _contentHidden = true

  const active = getActiveTab()
  if (active && active._tab && active._tab._visible) {
    active._tab.hideForOverlay()
  }

  hideActiveContent()

  // Critical: restore native stacking order AFTER content is manipulated.
  ensureMenuAboveContent()

  slideMenu(MENU_W)
}

function closeMenuOverlay() {
  if (!menuOpen) return

  menuOpen = false
  _contentHidden = false

  slideMenu(0, () => {
    showActiveContent()
  })
}

function slideMenu(targetWidth, onComplete) {
  if (menuSlideAnim) {
    clearInterval(menuSlideAnim)
    menuSlideAnim = null
  }

  const [winW, winH] = chromeWin.getSize()
  const startX = menuView.getBounds().x
  const targetX = targetWidth > 0
    ? winW - targetWidth
    : winW + 100

  const startTime = Date.now()

  menuSlideAnim = setInterval(() => {
    const t = Math.min(
      1,
      (Date.now() - startTime) / MENU_TRANSITION_MS
    )

    const ease = 1 - Math.pow(1 - t, 3)
    const x = Math.round(startX + (targetX - startX) * ease)

    try {
      menuView.setBounds({
        x,
        y: 0,
        width: MENU_W,
        height: winH,
      })
    } catch {}

    if (t >= 1) {
      clearInterval(menuSlideAnim)
      menuSlideAnim = null

      if (onComplete) onComplete()
    }
  }, 16)

  const isOpen = targetWidth > 0

  try {
    chromeWin.webContents.send('menu:state', isOpen)
  } catch {}

  try {
    if (
      menuView &&
      menuView.webContents &&
      !menuView.webContents.isDestroyed()
    ) {
      menuView.webContents.send('menu:state', isOpen)
    }
  } catch {}
}

function isMenuOpen() { return menuOpen }

/* ── Floating nav pill overlay ──────────────────────────────── */
function createPillOverlay() {
  if (!chromeWin || chromeWin.isDestroyed()) return
  try {
    pillView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload-pill.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        transparent: true,
      },
    })
    pillView.setBackgroundColor('#00000000')
    pillView.setVisible(false)
    chromeWin.contentView.addChildView(pillView)
    layoutPill()
    pillView.webContents.on('before-input-event', (event, input) => {
      forwardGlobalKey(input)
    })
    pillView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'pill.html')).catch((err) => {
      logger.warn('tabs', 'pill.html failed to load', { error: err.message })
    })
    pillView.setVisible(true)
    logger.info('tabs', 'Floating nav pill overlay created')
  } catch (e) {
    logger.error('tabs', 'Failed to create pill overlay', { error: e.message })
    pillView = null
  }
}

function layoutPill() {
  if (!pillView || !chromeWin || chromeWin.isDestroyed()) return
  const [w, h] = chromeWin.getSize()
  try {
    pillView.setBounds({
      x: Math.max(8, Math.round((w - PILL.width) / 2)),
      y: Math.max(TOOLBAR_Y + 8, h - PILL.height - PILL.bottom),
      width: PILL.width,
      height: PILL.height,
    })
  } catch (e) {
    logger.warn('tabs', 'layoutPill failed', { error: e.message })
  }
}

// Re-adding an already-attached child moves it to the END of the view stack,
// i.e. the TOPMOST paint/input layer. Call after every content-view change.
function ensurePillTop() {
  if (!pillView || !chromeWin || chromeWin.isDestroyed()) return
  try {
    chromeWin.contentView.addChildView(pillView)
    pillView.setVisible(true)
  } catch (e) {
    logger.warn('tabs', 'ensurePillTop failed', { error: e.message })
  }
}

// Single source of truth for chrome layout: content view + pill overlay.
// Called on window resize/move, tab changes, and panel/menu open/close.
function layoutChrome() {
  repositionActiveTab()
  layoutPill()
  ensurePillTop()
}

function getPillView() {
  return pillView
}

function getMenuView() {
  return menuView
}

/* ── Broadcast ─────────────────────────────────────────────── */
function broadcast() {
  if (!chromeWin || chromeWin.isDestroyed()) return
  let chromeOK = false
  try { chromeOK = !chromeWin.webContents.isDestroyed() } catch { return }
  if (!chromeOK) return
  const active = getActiveTab()
  let canBack = false
  let canFwd = false
  const view = active && active._tab ? active._tab : null
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    try { canBack = view.webContents.canGoBack(); canFwd = view.webContents.canGoForward() } catch {}
  }
  const args = [getAll(), active?.id || null, active?.url || '', active?.title || '', uiMode, canBack, canFwd]
  try { if (!chromeWin.webContents.isDestroyed()) chromeWin.webContents.send('tabs:changed', ...args) } catch {}
  if (pillView && pillView.webContents && !pillView.webContents.isDestroyed()) {
    try { pillView.webContents.send('tabs:changed', ...args) } catch {}
  }
}

// Forward Escape (and other hard-to-reach keys) from ANY WebContentsView to the
// chrome renderer, which owns the menu/panel close logic. Without this, pressing
// Escape while the page or the pill has focus never closes the slide-in menu and
// the content view stays shrunken (the "menu won't close / breaks everything"
// report).
function forwardGlobalKey(input) {
  if (!input || input.type !== 'keyDown') return
  if (input.key === 'Escape' || input.key === 'Esc') {
    if (menuOpen) closeMenuOverlay()
    // Also tell the chrome renderer to update its dimming class
    try { if (chromeWin && !chromeWin.isDestroyed() && !chromeWin.webContents.isDestroyed()) {
      chromeWin.webContents.send('menu:state', false)
    } } catch {}
  }
}

function getStateForContentsId(wcId) {
  const rec = tabs.find((t) => t._tab && t._tab.webContents && t._tab.webContents.id === wcId)
  if (!rec) return {}
  let host = ''
  try { host = new URL(rec.url).hostname } catch {}
  const rule = (config.get().siteRules || {})[host] || {}
  return { tabId: rec.id, host, rule }
}

function init(opts = {}) {
  setChromeWindow(opts.window)
  createMenuOverlay()
  createPillOverlay()
  create(opts)
  wireFullscreen()
}

/* ── HTML fullscreen support ────────────────────────────────── */
// WebContentsView children can trigger HTML fullscreen (e.g. YouTube).
// The BrowserWindow's webContents fires these events, and we expand
// the active content view to fill the window while hiding chrome UI.
function wireFullscreen() {
  if (!chromeWin || chromeWin.isDestroyed()) return
  chromeWin.webContents.on('enter-html-full-screen', () => enterFullscreen())
  chromeWin.webContents.on('leave-html-full-screen', () => leaveFullscreen())
}
function enterFullscreen() {
  if (_fullscreen) return
  _fullscreen = true
  try { if (!chromeWin.isDestroyed()) chromeWin.setFullScreen(true) } catch {}
  try { chromeWin.webContents.send('ui:fullscreen', true) } catch {}
  // Hide the pill overlay so it doesn't cover the fullscreen content
  try { if (pillView && !pillView.webContents.isDestroyed()) pillView.setVisible(false) } catch {}
  repositionActiveTab()
}
function leaveFullscreen() {
  if (!_fullscreen) return
  _fullscreen = false
  try { if (!chromeWin.isDestroyed()) chromeWin.setFullScreen(false) } catch {}
  try { chromeWin.webContents.send('ui:fullscreen', false) } catch {}
  try { if (pillView && !pillView.webContents.isDestroyed()) pillView.setVisible(true) } catch {}
  repositionActiveTab()
}
function isFullscreen() { return _fullscreen }


module.exports = {
  init, create, close, setActive, navigate, reload, stop,
  goBack, goForward, getActiveTab, getAll, getRecord, getTabView,
  setChromeWindow, getStateForContentsId, broadcast,
  showHome, showContent, repositionActiveTab, layoutChrome,
  setLifecycleCallbacks, getPillView, getMenuView, isFullscreen, enterFullscreen, leaveFullscreen,
  hideActiveContent, showActiveContent, isContentHidden,
  openMenuOverlay, closeMenuOverlay, isMenuOpen,
  PILL,
};
