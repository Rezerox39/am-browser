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
let rightInset = 0; // px reserved for slide-in panels (menu/settings)
let pillView = null; // transparent floating nav pill overlay (topmost layer)

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

    wc.on('did-navigate', (e, url) => {
      if (this._record) {
        this._record.url = url
        history.add({ url, title: this._record.title || url })
      }
      broadcast()
    })
    wc.on('did-navigate-in-page', (e, url) => {
      if (this._record) {
        this._record.url = url
        history.add({ url, title: this._record.title || url })
      }
      broadcast()
    })
    wc.on('page-title-updated', (e, title) => {
      if (this._record) this._record.title = title
      broadcast()
    })
    wc.on('page-favicon-updated', (e, favicons) => {
      if (this._record && favicons && favicons.length > 0) this._record.favicon = favicons[0]
    })
    wc.on('did-start-loading', () => {
      if (this._record) this._record.loading = true
      broadcast()
    })
    wc.on('did-stop-loading', () => {
      if (this._record) this._record.loading = false
      broadcast()
    })
    wc.on('did-fail-load', (e, errorCode, errorDesc, validatedUrl) => {
      if (this._record) {
        this._record.loading = false
        this._record.title = 'Error — ' + (errorDesc || errorCode)
      }
      logger.warn('tabs', 'Page failed to load', { url: validatedUrl, errorDesc })
      broadcast()
    })

    wc.setWindowOpenHandler(({ url }) => {
      if (!url || url.startsWith('about:') || url.startsWith('javascript:')) return { action: 'deny' }
      const rec = create({ url })
      select(rec.id)
      return { action: 'deny' }
    })

    wc.on('before-input-event', (event, input) => {
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
    // Full-bleed content: starts below the top chrome (tab strip + url bar)
    // and runs to the very bottom edge — the floating pill overlays this area
    // instead of reserving a black strip beneath it. A right-side inset keeps
    // slide-in panels (menu/settings) clickable.
    const w = Math.max(200, width - rightInset)
    this.view.setBounds({
      x: 0,
      y: TOOLBAR_Y,
      width: w,
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
    this.hide()
    try { this.window.contentView.removeChildView(this.view) } catch {}
    if (!this.webContents.isDestroyed()) {
      this.webContents.destroy()
    }
    this.view = undefined
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

  // Only show the view if there's a URL (so home stays clear)
  if (rec._tab && rec.url) {
    rec._tab.show()
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
function setRightInset(px) {
  rightInset = Math.max(0, Math.min(parseInt(px, 10) || 0, 600))
  layoutChrome()
}
function setLifecycleCallbacks(cb) {
  if (cb && typeof cb === 'object') lifecycle = { ...lifecycle, ...cb }
}


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

/* ── Broadcast ─────────────────────────────────────────────── */
function broadcast() {
  if (!chromeWin || chromeWin.webContents.isDestroyed()) return
  const active = getActiveTab()
  let canBack = false
  let canFwd = false
  const view = active && active._tab ? active._tab : null
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    try { canBack = view.webContents.canGoBack(); canFwd = view.webContents.canGoForward() } catch {}
  }
  const args = [getAll(), active?.id || null, active?.url || '', active?.title || '', uiMode, canBack, canFwd]
  chromeWin.webContents.send('tabs:changed', ...args)
  if (pillView && pillView.webContents && !pillView.webContents.isDestroyed()) {
    pillView.webContents.send('tabs:changed', ...args)
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
  createPillOverlay()
  create(opts)
}

module.exports = {
  init, create, close, setActive, navigate, reload, stop,
  goBack, goForward, getActiveTab, getAll, getRecord, getTabView,
  setChromeWindow, getStateForContentsId, broadcast,
  showHome, showContent, repositionActiveTab, layoutChrome,
  setRightInset, setLifecycleCallbacks, getPillView,
  PILL,
};
