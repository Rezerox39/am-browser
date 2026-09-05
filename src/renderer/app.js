'use strict';
(() => {
  const api = window.am;
  if (!api) {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-family:sans-serif;font-size:16px">Preload unavailable</div>';
    return;
  }
  const $ = id => document.getElementById(id);

  /* ── i18n ─────────────────────────────────────────────────── */
  const i18n = {
    s: {}, f: {},
    async init() {
      try {
        const cfg = await api.invoke('settings:get');
        const lang = cfg.language || 'en';
        await this.load(lang);
        if (lang !== 'en' && !Object.keys(this.f).length) try { this.f = await (await fetch('../shared/i18n/locales/en.json')).json(); } catch {}
      } catch {}
    },
    async load(lang) {
      try { this.s = await (await fetch('../shared/i18n/locales/' + lang + '.json')).json(); } catch { this.s = {}; }
      if (!Object.keys(this.f).length) try { this.f = await (await fetch('../shared/i18n/locales/en.json')).json(); } catch {}
    },
    t(k) { return this.s[k] || this.f[k] || k; },
  };
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(e => { const k = e.getAttribute('data-i18n'); if (k) e.textContent = i18n.t(k); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(e => { const k = e.getAttribute('data-i18n-placeholder'); if (k) e.placeholder = i18n.t(k); });
  }

  /* ── State ────────────────────────────────────────────────── */
  let allTabs = [], activeId = '', activeUrl = '', activeTitle = '';
  let currentPanel = '';

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
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ── Navigation (ALL invoke, NEVER send) ──────────────────── */
  async function navigate(url) {
    try {
      const id = await api.invoke('tabs:getActiveId');
      if (!id) return;
      await api.invoke('tabs:navigate', id, url);
    } catch (e) { console.error('navigate error', e); }
  }
  function normalize(v) {
    const s = v.trim();
    if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }

  /* ── Tab strip ────────────────────────────────────────────── */
  function renderTabs() {
    tabStrip.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'tab-chip' + (tab.id === activeId ? ' active' : '');
      el.innerHTML = '<span class="tc-favicon">' + (tab.loading ? '⟳' : favicon(tab.url)) + '</span><span class="tc-title">' + (tab.title || 'New Tab') + '</span><span class="tc-close">✕</span>';
      el.querySelector('.tc-close').addEventListener('click', e => { e.stopPropagation(); api.invoke('tabs:close', tab.id); });
      el.addEventListener('click', () => api.invoke('tabs:setActive', tab.id));
      tabStrip.appendChild(el);
    }
    if (tabCount) tabCount.textContent = allTabs.length || 1;
  }

  /* ── View sync ────────────────────────────────────────────── */
  function syncView() {
    const hasUrl = !!activeUrl;
    homeEl.classList.toggle('hidden', hasUrl);
    urlBar.style.display = hasUrl ? 'flex' : 'none';
    urlBarText.textContent = hasUrl ? (activeTitle || activeUrl) : '';
    urlEditBar.classList.add('hidden');
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
  });
  urlInput.addEventListener('blur', () => setTimeout(closeUrlEdit, 150));

  /* ── Home search (sole search interface) ──────────────────── */
  homeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const url = normalize(homeInput.value);
      if (url) navigate(url);
      homeInput.value = '';
    }
    e.stopPropagation();
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
    if (action === 'New Tab') api.invoke('tabs:create', {});
    else if (action === 'Bookmarks') openPanel('bookmarks', 'Bookmarks');
    else if (action === 'History') openPanel('history', 'History');
    else if (action === 'Downloads') openPanel('downloads', 'Downloads');
    else if (action === 'Refresh') { if (activeId) api.invoke('tabs:reload', activeId); }
    else if (action === 'Settings') openPanel('settings', 'Settings');
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
    let items; try { items = q ? await api.invoke('history:search', q, 50) : await api.invoke('history:getRecent', 100); } catch { return empty('Error loading history'); }
    if (!items.length) return empty(i18n.t('history.empty'));
    panelBody.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<div class="pi-title">' + (it.title || it.url) + '</div><div class="pi-url">' + it.url + '</div>';
      d.addEventListener('click', () => { navigate(it.url); closePanel(); });
      panelBody.appendChild(d);
    }
  }
  async function renderBookmarks() {
    let items; try { items = await api.invoke('bookmarks:getAll'); } catch { return empty('Error'); }
    if (!items.length) return empty(i18n.t('bookmarks.empty'));
    panelBody.innerHTML = '';
    for (const bm of items) {
      const d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<div class="pi-title">' + (bm.title || bm.url) + '</div><div class="pi-url">' + bm.url + '</div><span class="pi-del">✕</span>';
      d.addEventListener('click', () => { navigate(bm.url); closePanel(); });
      d.querySelector('.pi-del').addEventListener('click', async e => { e.stopPropagation(); await api.invoke('bookmarks:remove', bm.id); renderBookmarks(); });
      panelBody.appendChild(d);
    }
  }
  async function renderDownloads() {
    let items; try { items = await api.invoke('downloads:getAll'); } catch { return empty('Error'); }
    if (!items.length) return empty(i18n.t('downloads.empty'));
    panelBody.innerHTML = '';
    for (const dl of items) {
      const st = dl.state === 'progressing' ? 'Downloading...' : dl.state === 'failed' ? 'Failed' : dl.state === 'cancelled' ? 'Cancelled' : 'Complete';
      const d = document.createElement('div'); d.className = 'dl-item';
      d.innerHTML = '<div class="dl-name">' + dl.filename + '</div><div class="dl-meta">' + st + ' · ' + fmtBytes(dl.receivedBytes || dl.totalBytes) + '</div><div class="dl-actions"><button>Open</button><button>Remove</button></div>';
      d.querySelectorAll('button')[0].addEventListener('click', () => { if (dl.state === 'complete' && dl.savePath) api.invoke('downloads:openFile', dl.savePath); });
      d.querySelectorAll('button')[1].addEventListener('click', async () => { await api.invoke('downloads:remove', dl.id); renderDownloads(); });
      panelBody.appendChild(d);
    }
  }
  async function renderSettings() {
    const cfg = await api.invoke('settings:get');
    const avail = await api.invoke('i18n:getAvailable');
    panelBody.innerHTML = '';
    const sec = t => { const el = document.createElement('div'); el.className = 'sec-title'; el.textContent = t; return el; };
    const row = (lbl, ctrl) => { const el = document.createElement('div'); el.className = 'mg-item'; el.innerHTML = '<label>' + lbl + '</label>'; el.appendChild(typeof ctrl === 'string' ? Object.assign(document.createElement('span'), { className: 'sub', innerHTML: ctrl }) : ctrl); return el; };
    const sw = (on, cb) => { const el = document.createElement('div'); el.className = 'switch' + (on ? ' on' : ''); el.addEventListener('click', () => { el.classList.toggle('on'); cb(el.classList.contains('on')); }); return el; };
    const sel = (opts, val, cb) => { const s = document.createElement('select'); s.className = 'setting-sel'; opts.forEach(o => { const op = document.createElement('option'); op.value = o.v; op.textContent = o.l; if (o.v === val) op.selected = true; s.appendChild(op); }); s.addEventListener('change', () => cb(s.value)); return s; };

    panelBody.appendChild(sec('General'));
    panelBody.appendChild(row('Language', sel(avail.map(l => ({ v: l, l: l.toUpperCase() })), cfg.language, async v => { await api.invoke('settings:set', 'language', v); await i18n.load(v); applyI18n(); renderSettings(); })));
    panelBody.appendChild(row('Search Engine', sel([{ v: 'google', l: 'Google' }, { v: 'bing', l: 'Bing' }, { v: 'duckduckgo', l: 'DuckDuckGo' }], cfg.searchEngine, v => api.invoke('settings:set', 'searchEngine', v))));
    panelBody.appendChild(sec('Ad Blocking'));
    panelBody.appendChild(row('Ad Blocking', sw(cfg.adblock.enabled, v => { cfg.adblock.enabled = v; api.invoke('settings:set', 'adblock', cfg.adblock); })));
    const st = await api.invoke('adblock:getStats').catch(() => null);
    if (st) panelBody.appendChild(row('Blocked', '<span style="color:var(--accent)">' + st.blocked + '</span>'));
    panelBody.appendChild(sec('Clear'));
    const clrBtn = document.createElement('button'); clrBtn.className = 'btn'; clrBtn.textContent = 'Clear History';
    clrBtn.addEventListener('click', async () => { if (confirm('Clear all history?')) { await api.invoke('history:clear'); toast('History cleared'); } });
    panelBody.appendChild(clrBtn);
  }
  async function renderSiteSettings() {
    if (!activeUrl) return empty('No site loaded');
    let host; try { host = new URL(activeUrl).hostname; } catch { return empty('—'); }
    let rule; try { rule = await api.invoke('site:getRule', host); } catch { rule = {}; }
    rule = rule || {};
    panelBody.innerHTML = '';
    const hostEl = document.createElement('div'); hostEl.className = 'mg-item'; hostEl.innerHTML = '<label style="font-family:monospace;font-size:12px;color:var(--accent)">' + host + '</label>';
    panelBody.appendChild(hostEl);
    const sw = (on, cb) => { const el = document.createElement('div'); el.className = 'switch' + (on ? ' on' : ''); el.addEventListener('click', () => { el.classList.toggle('on'); cb(el.classList.contains('on')); }); return el; };
    const row = (lbl, ctrl) => { const el = document.createElement('div'); el.className = 'mg-item'; el.innerHTML = '<label>' + lbl + '</label>'; el.appendChild(ctrl); return el; };
    for (const [lbl, rk] of [['Ad blocking', 'adblockEnabled'], ['JavaScript', 'javascript'], ['Pop-ups', 'popups']]) {
      panelBody.appendChild(row(lbl, sw(rule[rk] || false, v => { rule[rk] = v; api.invoke('site:setRule', host, rule); toast('Saved'); })));
    }
  }

  /* ── Button wiring (ALL use api.invoke) ───────────────────── */
  $('navBack').addEventListener('click', async () => {
    if (!activeId) return;
    try { await api.invoke('tabs:goBack', activeId); } catch (e) { console.error('goBack', e); }
  });
  $('navForward').addEventListener('click', async () => {
    if (!activeId) return;
    try { await api.invoke('tabs:goForward', activeId); } catch (e) { console.error('goForward', e); }
  });
  $('navHome').addEventListener('click', () => {
    homeEl.classList.remove('hidden');
    urlBar.style.display = 'none';
    homeInput.value = '';
    setTimeout(() => homeInput.focus(), 50);
  });
  $('navTabs').addEventListener('click', async () => {
    try {
      const tabs = await api.invoke('tabs:getAll');
      if (tabs && tabs.length > 1) {
        const idx = (tabs.findIndex(t => t.id === activeId) + 1) % tabs.length;
        await api.invoke('tabs:setActive', tabs[idx].id);
      }
    } catch (e) { console.error('tabs cycle', e); }
  });
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

  // macOS window controls (ALL use api.invoke)
  $('btnClose').addEventListener('click', async () => { try { await api.invoke('window:close'); } catch {} });
  $('btnMinimize').addEventListener('click', async () => { try { await api.invoke('window:minimize'); } catch {} });
  $('btnMaximize').addEventListener('click', async () => { try { await api.invoke('window:maximize'); } catch {} });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const m = e.ctrlKey || e.metaKey;
    if (m && e.key === 't') { e.preventDefault(); api.invoke('tabs:create', {}); }
    if (m && e.key === 'l') { e.preventDefault(); openUrlEdit(); }
    if (m && e.key === 'w') { e.preventDefault(); if (activeId) api.invoke('tabs:close', activeId); }
  });

  // IPC from main
  api.on('tabs:changed', (tabs, aid, url, title) => {
    allTabs = Array.isArray(tabs) ? tabs : [];
    activeId = aid || '';
    activeUrl = url || '';
    activeTitle = title || '';
    renderTabs();
    syncView();
  });
  api.on('window:maximized', isMax => {
    const dot = $('btnMaximize');
    if (dot) dot.title = isMax ? 'Restore' : 'Maximize';
  });

  /* ── Init ─────────────────────────────────────────────────── */
  (async () => {
    await i18n.init();
    applyI18n();
    try {
      const tabs = await api.invoke('tabs:getAll');
      const aid = await api.invoke('tabs:getActiveId');
      if (Array.isArray(tabs)) { allTabs = tabs; activeId = aid || ''; }
    } catch (e) { console.error('init tabs', e); }
    renderTabs();
    syncView();
    setTimeout(() => homeInput.focus(), 100);
  })();
})();
