'use strict';
(() => {
  const api = window.am;
  if (!api) {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-family:sans-serif;font-size:16px">Preload unavailable</div>';
    return;
  }
  const $ = id => document.getElementById(id);

  /* ── i18n ─────────────────────────────────────────────────── */
  const i18n = { s: {} };
  async function initI18n() {
    try {
      const strings = await api.invoke('i18n:getStrings');
      if (strings && typeof strings === 'object') i18n.s = strings;
    } catch (e) { console.warn('i18n load failed', e); }
    try {
      const cfg = await api.invoke('settings:get');
      const lang = cfg.language || 'en';
      if (lang !== 'en') {
        await api.invoke('i18n:setLocale', lang);
        const localized = await api.invoke('i18n:getStrings');
        if (localized && typeof localized === 'object') i18n.s = localized;
      }
    } catch (e) { console.warn('i18n lang failed', e); }
  }
  function t(k) { return i18n.s[k] || k; }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n'); if (k) el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder'); if (k) el.placeholder = t(k);
    });
  }

  /* ── State ────────────────────────────────────────────────── */
  let allTabs = [], activeId = '', activeUrl = '', activeTitle = '';
  let currentPanel = '';
  let _showingHome = true; // tracks whether we're on home or content

  /* ── DOM refs ─────────────────────────────────────────────── */
  const tabStrip = $('tabStrip'), tabCount = $('tabCount');
  const urlBar = $('urlBar'), urlBarText = $('urlBarText');
  const urlEditBar = $('urlEditBar'), urlInput = $('urlInput');
  const homeEl = $('home'), homeInput = $('home-input');
  const menuBackdrop = $('menu-backdrop'), sideMenu = $('side-menu'), sideMenuGrid = $('side-menu-grid');
  const panelBackdrop = $('panel-backdrop'), panel = $('panel');
  const panelTitle = $('panel-title'), panelBody = $('panel-body');
  const panelAction = $('panel-action'), panelSearch = $('panel-search');

  /* ── Helpers ──────────────────────────────────────────────── */
  function favicon(url) { try { return new URL(url).hostname[0]?.toUpperCase() || '?'; } catch { return '?'; } }
  function fmtBytes(b) { if (!b || isNaN(b)) return '0 B'; const u = ['B','KB','MB','GB']; let i = 0, n = b; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function toast(msg) {
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }
  async function safeInvoke(channel, ...args) {
    try { return await api.invoke(channel, ...args); }
    catch (e) { console.error('IPC failed:', channel, e); return undefined; }
  }

  /* ── Navigation ───────────────────────────────────────────── */
  function normalize(v) {
    const s = v.trim();
    if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }
  async function navigate(url) {
    try {
      // Use activeId directly if we know it, otherwise fetch
      const id = activeId || await safeInvoke('tabs:getActiveId');
      if (!id) { console.warn('navigate: no active tab'); return; }
      await safeInvoke('tabs:navigate', id, url);
    } catch (e) { console.error('navigate error', e); }
  }

  /* ── Tab strip ────────────────────────────────────────────── */
  function renderTabs() {
    tabStrip.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'tab-chip' + (tab.id === activeId ? ' active' : '');
      el.innerHTML =
        '<span class="tc-favicon">' + (tab.loading ? '⟳' : favicon(tab.url)) + '</span>' +
        '<span class="tc-title">' + (tab.title || 'New Tab') + '</span>' +
        '<span class="tc-close">✕</span>';
      el.querySelector('.tc-close').addEventListener('click', e => {
        e.stopPropagation();
        safeInvoke('tabs:close', tab.id);
      });
      el.addEventListener('click', () => {
        if (tab.id !== activeId) safeInvoke('tabs:setActive', tab.id);
      });
      tabStrip.appendChild(el);
    }
    // Add new-tab button at the end
    const addBtn = document.createElement('div');
    addBtn.className = 'tab-chip tc-add';
    addBtn.innerHTML = '<span class="tc-plus">+</span>';
    addBtn.addEventListener('click', () => safeInvoke('tabs:create', {}));
    tabStrip.appendChild(addBtn);
    if (tabCount) tabCount.textContent = allTabs.length || 1;
  }

  /* ── View sync — only sends IPC when home/content state changes ── */
  async function syncView() {
    const hasUrl = !!activeUrl;
    const wasHome = _showingHome;
    _showingHome = !hasUrl;

    if (hasUrl) {
      homeEl.classList.add('hidden');
      urlBar.style.display = 'flex';
      urlBarText.textContent = activeTitle || activeUrl;
      urlEditBar.classList.add('hidden');
      // Tell main to show the WebContentsView (only on transition)
      if (wasHome) await safeInvoke('tabs:showContent');
    } else {
      homeEl.classList.remove('hidden');
      urlBar.style.display = 'none';
      urlEditBar.classList.add('hidden');
      // Tell main to hide the WebContentsView (only on transition)
      if (!wasHome) await safeInvoke('tabs:showHome');
    }
  }

  function enterHome() {
    _showingHome = true;
    homeEl.classList.remove('hidden');
    urlBar.style.display = 'none';
    urlEditBar.classList.add('hidden');
    safeInvoke('tabs:showHome');
    setTimeout(() => homeInput.focus(), 50);
  }

  /* ── URL edit bar ─────────────────────────────────────────── */
  function openUrlEdit() {
    urlEditBar.classList.remove('hidden');
    urlBar.style.display = 'none';
    urlInput.value = activeUrl || '';
    urlInput.focus();
    urlInput.select();
  }
  function closeUrlEdit() {
    urlEditBar.classList.add('hidden');
    urlBar.style.display = activeUrl ? 'flex' : 'none';
  }
  urlBar.addEventListener('click', openUrlEdit);
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const url = normalize(urlInput.value);
      if (url) navigate(url);
      closeUrlEdit();
    }
    if (e.key === 'Escape') closeUrlEdit();
    e.stopPropagation();
  });
  urlInput.addEventListener('blur', () => setTimeout(closeUrlEdit, 200));

  /* ── Home search ──────────────────────────────────────────── */
  homeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = homeInput.value.trim();
      if (!val) return;
      const url = normalize(val);
      if (url) {
        homeInput.value = '';
        homeInput.blur();
        navigate(url);
      }
    }
    if (e.key === 'Escape') homeInput.blur();
    e.stopPropagation();
  });
  homeEl.addEventListener('click', e => {
    if (e.target !== homeInput) setTimeout(() => homeInput.focus(), 20);
  });

  /* ── Menu ─────────────────────────────────────────────────── */
  const MENU_ITEMS = [
    { label: 'New Tab', icon: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' },
    { label: 'Bookmarks', icon: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>' },
    { label: 'History', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { label: 'Downloads', icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' },
    { label: 'Refresh', icon: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>' },
    { label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  ];
  function buildMenu() {
    sideMenuGrid.innerHTML = '';
    MENU_ITEMS.forEach(item => {
      const el = document.createElement('div');
      el.className = 'sheet-item';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">' + item.icon + '</svg><span>' + item.label + '</span>';
      el.addEventListener('click', () => handleMenu(item.label));
      sideMenuGrid.appendChild(el);
    });
  }
  function handleMenu(action) {
    closeMenu();
    if (action === 'New Tab') safeInvoke('tabs:create', {});
    else if (action === 'Bookmarks') openPanel('bookmarks', t('bookmarks.title'));
    else if (action === 'History') openPanel('history', t('history.title'));
    else if (action === 'Downloads') openPanel('downloads', t('downloads.title'));
    else if (action === 'Refresh') { if (activeId) safeInvoke('tabs:reload', activeId); }
    else if (action === 'Settings') openPanel('settings', t('settings.title'));
  }
  function openMenu() { buildMenu(); menuBackdrop.classList.add('open'); sideMenu.classList.add('open'); }
  function closeMenu() { menuBackdrop.classList.remove('open'); sideMenu.classList.remove('open'); }

  /* ── Panels ───────────────────────────────────────────────── */
  function openPanel(type, title) {
    panelTitle.textContent = title;
    panelAction.innerHTML = '';
    panelSearch.classList.add('hidden');
    panelSearch.value = '';
    if (type === 'history') panelSearch.classList.remove('hidden');
    panelBackdrop.classList.add('open');
    panel.classList.add('open');
    currentPanel = type;
    closeMenu();
    loadPanel();
  }
  function closePanel() {
    panelBackdrop.classList.remove('open');
    panel.classList.remove('open');
    currentPanel = '';
  }
  async function loadPanel() {
    if (currentPanel === 'history') return renderHistory();
    if (currentPanel === 'bookmarks') return renderBookmarks();
    if (currentPanel === 'downloads') return renderDownloads();
    if (currentPanel === 'settings') return renderSettings();
    if (currentPanel === 'siteSettings') return renderSiteSettings();
  }
  function empty(msg) { panelBody.innerHTML = '<div class="empty-state">' + msg + '</div>'; }

  async function renderHistory() {
    const q = panelSearch.value.trim();
    let items;
    try {
      items = q ? await safeInvoke('history:search', q, 50) : await safeInvoke('history:getRecent', 100);
      if (!Array.isArray(items)) items = [];
    } catch { return empty('Error loading history'); }
    if (!items.length) return empty(t('history.empty'));
    panelBody.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<div class="pi-title">' + (it.title || it.url) + '</div><div class="pi-url">' + it.url + '</div>';
      d.addEventListener('click', () => { navigate(it.url); closePanel(); });
      panelBody.appendChild(d);
    }
  }
  async function renderBookmarks() {
    let items;
    try { items = await safeInvoke('bookmarks:getAll'); if (!Array.isArray(items)) items = []; } catch { return empty('Error'); }
    if (!items.length) return empty(t('bookmarks.empty'));
    panelBody.innerHTML = '';
    for (const bm of items) {
      const d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<div class="pi-title">' + (bm.title || bm.url) + '</div><div class="pi-url">' + bm.url + '</div><span class="pi-del">✕</span>';
      d.addEventListener('click', () => { navigate(bm.url); closePanel(); });
      d.querySelector('.pi-del').addEventListener('click', async e => { e.stopPropagation(); await safeInvoke('bookmarks:remove', bm.id); renderBookmarks(); });
      panelBody.appendChild(d);
    }
  }
  async function renderDownloads() {
    let items;
    try { items = await safeInvoke('downloads:getAll'); if (!Array.isArray(items)) items = []; } catch { return empty('Error'); }
    if (!items.length) return empty(t('downloads.empty'));
    panelBody.innerHTML = '';
    for (const dl of items) {
      const st = dl.state === 'progressing' ? t('downloads.downloading') : dl.state === 'failed' ? t('downloads.failed') : dl.state === 'cancelled' ? t('downloads.cancelled') : t('downloads.complete');
      const d = document.createElement('div'); d.className = 'dl-item';
      d.innerHTML = '<div class="dl-name">' + dl.filename + '</div><div class="dl-meta">' + st + ' · ' + fmtBytes(dl.receivedBytes || dl.totalBytes) + '</div><div class="dl-actions"><button>' + t('downloads.open') + '</button><button>' + t('downloads.remove') + '</button></div>';
      d.querySelectorAll('button')[0].addEventListener('click', () => { if (dl.state === 'complete' && dl.savePath) safeInvoke('downloads:openFile', dl.savePath); });
      d.querySelectorAll('button')[1].addEventListener('click', async () => { await safeInvoke('downloads:remove', dl.id); renderDownloads(); });
      panelBody.appendChild(d);
    }
  }
  async function renderSettings() {
    const cfg = await safeInvoke('settings:get');
    const avail = await safeInvoke('i18n:getAvailable');
    panelBody.innerHTML = '';
    const sec = title => { const el = document.createElement('div'); el.className = 'sec-title'; el.textContent = title; return el; };
    const item = (label, ctrl) => { const el = document.createElement('div'); el.className = 'mg-item'; el.innerHTML = '<label>' + label + '</label>'; el.appendChild(ctrl); return el; };

    panelBody.appendChild(sec(t('settings.language')));
    const sel = document.createElement('select'); sel.className = 'setting-sel';
    (avail || []).forEach(loc => { const o = document.createElement('option'); o.value = loc; o.textContent = loc.toUpperCase(); if (loc === cfg.language) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', async () => { await safeInvoke('settings:set', 'language', sel.value); await initI18n(); applyI18n(); toast('Language: ' + sel.value); });
    panelBody.appendChild(item(t('settings.language'), sel));

    panelBody.appendChild(sec(t('settings.searchEngine')));
    const engines = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' };
    const engSel = document.createElement('select'); engSel.className = 'setting-sel';
    Object.entries(engines).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v; if (k === cfg.searchEngine) o.selected = true; engSel.appendChild(o); });
    engSel.addEventListener('change', () => { safeInvoke('settings:set', 'searchEngine', engSel.value); toast('Search: ' + engines[engSel.value]); });
    panelBody.appendChild(item(t('settings.searchEngine'), engSel));

    panelBody.appendChild(sec(t('settings.adblocking')));
    const abSw = document.createElement('div');
    abSw.className = 'switch' + (cfg.adblock?.enabled ? ' on' : '');
    abSw.addEventListener('click', () => { abSw.classList.toggle('on'); safeInvoke('settings:set', 'adblock', { ...cfg.adblock, enabled: abSw.classList.contains('on') }); toast(abSw.classList.contains('on') ? 'Ad blocking: ON' : 'Ad blocking: OFF'); });
    panelBody.appendChild(item(t('settings.adblockEnabled'), abSw));

    panelBody.appendChild(sec(t('settings.clearData')));
    const clrBtn = document.createElement('button'); clrBtn.className = 'btn'; clrBtn.textContent = t('settings.clearHistory');
    clrBtn.addEventListener('click', async () => { if (confirm(t('dialog.clearHistory'))) { await safeInvoke('history:clear'); toast('History cleared'); } });
    panelBody.appendChild(clrBtn);
  }
  async function renderSiteSettings() {
    if (!activeUrl) return empty('No site loaded');
    let host; try { host = new URL(activeUrl).hostname; } catch { return empty('—'); }
    let rule; try { rule = await safeInvoke('site:getRule', host); } catch { rule = {}; }
    rule = rule || {};
    panelBody.innerHTML = '';
    const hostEl = document.createElement('div'); hostEl.className = 'mg-item'; hostEl.innerHTML = '<label style="font-family:monospace;font-size:12px;color:var(--accent)">' + host + '</label>';
    panelBody.appendChild(hostEl);
    const sw = (on, cb) => { const el = document.createElement('div'); el.className = 'switch' + (on ? ' on' : ''); el.addEventListener('click', () => { el.classList.toggle('on'); cb(el.classList.contains('on')); }); return el; };
    const row = (lbl, ctrl) => { const el = document.createElement('div'); el.className = 'mg-item'; el.innerHTML = '<label>' + lbl + '</label>'; el.appendChild(ctrl); return el; };
    for (const [lbl, rk] of [[t('site.adblock'), 'adblockEnabled'], [t('site.javascript'), 'javascript'], [t('site.popups'), 'popups']]) {
      panelBody.appendChild(row(lbl, sw(rule[rk] || false, v => { rule[rk] = v; safeInvoke('site:setRule', host, rule); toast('Saved'); })));
    }
  }

  /* ── Navigation pill buttons ──────────────────────────────── */
  $('navBack').addEventListener('click', async () => {
    const id = activeId || await safeInvoke('tabs:getActiveId');
    if (!id) return;
    try { await safeInvoke('tabs:goBack', id); } catch (e) { console.error('goBack', e); toast('Cannot go back'); }
  });
  $('navForward').addEventListener('click', async () => {
    const id = activeId || await safeInvoke('tabs:getActiveId');
    if (!id) return;
    try { await safeInvoke('tabs:goForward', id); } catch (e) { console.error('goForward', e); toast('Cannot go forward'); }
  });
  $('navHome').addEventListener('click', () => enterHome());
  // Tab button: ALWAYS creates a new tab (Chrome behavior)
  $('navTabs').addEventListener('click', () => safeInvoke('tabs:create', {}));
  $('navMenu').addEventListener('click', openMenu);

  // Menu footer
  $('menu-history').addEventListener('click', () => handleMenu('History'));
  $('menu-bookmarks').addEventListener('click', () => handleMenu('Bookmarks'));
  $('menu-downloads').addEventListener('click', () => handleMenu('Downloads'));
  $('menu-settings').addEventListener('click', () => handleMenu('Settings'));
  $('menu-close-btn').addEventListener('click', closeMenu);

  // Backdrops
  menuBackdrop.addEventListener('click', closeMenu);
  panelBackdrop.addEventListener('click', closePanel);
  $('panel-back').addEventListener('click', closePanel);
  panelSearch.addEventListener('input', loadPanel);

  // macOS window controls
  $('btnClose').addEventListener('click', async () => { try { await safeInvoke('window:close'); } catch {} });
  $('btnMinimize').addEventListener('click', async () => { try { await safeInvoke('window:minimize'); } catch {} });
  $('btnMaximize').addEventListener('click', async () => { try { await safeInvoke('window:maximize'); } catch {} });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const m = e.ctrlKey || e.metaKey;
    if (m && e.key === 't') { e.preventDefault(); safeInvoke('tabs:create', {}); }
    if (m && e.key === 'l') { e.preventDefault(); openUrlEdit(); }
    if (m && e.key === 'w') { e.preventDefault(); if (activeId) safeInvoke('tabs:close', activeId); }
    if (e.key === 'Escape') { closeMenu(); closePanel(); }
  });

  /* ── IPC from main process ────────────────────────────────── */
  api.on('tabs:changed', (tabs, aid, url, title) => {
    allTabs = Array.isArray(tabs) ? tabs : [];
    activeId = aid || '';
    activeUrl = url || '';
    activeTitle = title || '';
    renderTabs();
    syncView();
  });
  api.on('tabs:focusAddressBar', () => openUrlEdit());
  api.on('window:maximized', isMax => {
    const dot = $('btnMaximize');
    if (dot) dot.title = isMax ? t('window.restore') : t('window.maximize');
  });

  /* ── Init ─────────────────────────────────────────────────── */
  (async () => {
    await initI18n();
    applyI18n();

    // Fetch initial tab state
    try {
      const tabs = await safeInvoke('tabs:getAll');
      const aid = await safeInvoke('tabs:getActiveId');
      if (Array.isArray(tabs)) allTabs = tabs;
      if (aid) activeId = aid;
    } catch (e) { console.error('init tabs error', e); }

    renderTabs();

    // Start on home screen
    _showingHome = true;
    homeEl.classList.remove('hidden');
    urlBar.style.display = 'none';
    urlEditBar.classList.add('hidden');
    // Tell main to hide the view
    safeInvoke('tabs:showHome');

    setTimeout(() => homeInput.focus(), 100);
  })();
})();
