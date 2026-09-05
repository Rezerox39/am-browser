'use strict';
(() => {
  const api = window.am;
  if (!api) { document.body.innerHTML = '<h1 style="color:#fff;padding:40px">Preload unavailable</h1>'; return; }

  const $ = id => document.getElementById(id);

  /* ── i18n ──────────────────────────────────────────────────── */
  const i18n = {
    strings: {}, fallback: {},
    async init() {
      try {
        const s = await api.invoke('settings:get');
        await this.loadFor(s.language || 'en');
        if (s.language !== 'en') try { this.fallback = await (await fetch('i18n/locales/en.json')).json(); } catch {}
      } catch {}
    },
    async loadFor(l) {
      try { this.strings = await (await fetch('i18n/locales/' + l + '.json')).json(); } catch { this.strings = this.fallback; }
      if (l !== 'en' && !Object.keys(this.fallback).length) try { this.fallback = await (await fetch('i18n/locales/en.json')).json(); } catch {}
    },
    t(k, v) {
      let s = this.strings[k] || this.fallback[k] || k;
      if (v) Object.entries(v).forEach(([a,b]) => { s = s.split('{{'+a+'}}').join(String(b)); });
      return s;
    },
  };
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(e => { const k = e.getAttribute('data-i18n'); if (k) e.textContent = i18n.t(k); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(e => { const k = e.getAttribute('data-i18n-placeholder'); if (k) e.placeholder = i18n.t(k); });
  }

  /* ── State ─────────────────────────────────────────────────── */
  let allTabs = [], activeId = '', activeUrl = '', activeTitle = '';
  let currentPanel = '';

  /* ── DOM refs ──────────────────────────────────────────────── */
  const tabStrip = $('tabStrip');
  const tabCount = $('tabCount');
  const urlBar = $('urlBar'), urlBarText = $('urlBarText');
  const urlEditBar = $('urlEditBar'), urlInput = $('urlInput');
  const homeEl = $('home');
  const homeInput = $('home-input');
  const menuBackdrop = $('menu-backdrop'), sideMenu = $('side-menu'), sideMenuGrid = $('side-menu-grid');
  const panelBackdrop = $('panel-backdrop'), panel = $('panel'), panelTitle = $('panel-title'), panelBody = $('panel-body'), panelAction = $('panel-action'), panelSearch = $('panel-search');

  /* ── Helpers ───────────────────────────────────────────────── */
  function favicon(url) { try { return new URL(url).hostname[0]?.toUpperCase() || '?'; } catch { return '?'; } }
  function fmtBytes(b) { if (!b || isNaN(b)) return '0 B'; const u = ['B','KB','MB','GB']; let i = 0, n = b; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function showToast(msg) {
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ── Navigation ────────────────────────────────────────────── */
  async function navigate(url) {
    const id = await api.invoke('tabs:getActiveId');
    if (!id) return;
    await api.invoke('tabs:navigate', id, url);
  }
  function normalize(v) {
    const s = v.trim(); if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }

  /* ── Tab strip ─────────────────────────────────────────────── */
  function renderTabs() {
    tabStrip.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'tab-chip' + (tab.id === activeId ? ' active' : '');
      const fav = document.createElement('span');
      fav.className = 'tc-favicon';
      fav.textContent = tab.loading ? '⟳' : favicon(tab.url);
      const title = document.createElement('span');
      title.className = 'tc-title';
      title.textContent = tab.title || 'New Tab';
      const close = document.createElement('span');
      close.className = 'tc-close';
      close.textContent = '✕';
      close.addEventListener('click', e => { e.stopPropagation(); api.send('tabs:close', tab.id); });
      el.appendChild(fav);
      el.appendChild(title);
      el.appendChild(close);
      el.addEventListener('click', () => api.send('tabs:setActive', tab.id));
      tabStrip.appendChild(el);
    }
    if (tabCount) tabCount.textContent = allTabs.length || 1;
  }

  /* ── URL bar + home visibility ─────────────────────────────── */
  function syncView() {
    const hasUrl = !!activeUrl;
    homeEl.classList.toggle('hidden', hasUrl);
    urlBar.classList.toggle('hidden', !hasUrl);
    urlBarText.textContent = hasUrl ? activeUrl : '';
    urlEditBar.classList.add('hidden');
    urlBar.style.display = hasUrl ? '' : 'none';
  }

  /* ── URL edit bar ──────────────────────────────────────────── */
  function openUrlEdit() {
    urlEditBar.classList.remove('hidden');
    urlBar.classList.add('hidden');
    urlInput.value = activeUrl || '';
    urlInput.focus();
    urlInput.select();
  }
  function closeUrlEdit() {
    urlEditBar.classList.add('hidden');
    urlBar.classList.remove('hidden');
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
  urlInput.addEventListener('blur', () => { setTimeout(closeUrlEdit, 150); });

  /* ── Home search (sole search interface) ───────────────────── */
  homeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const url = normalize(homeInput.value);
      if (url) navigate(url);
      homeInput.value = '';
    }
    e.stopPropagation();
  });

  /* ── Menu ──────────────────────────────────────────────────── */
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
    if (action === 'New Tab') api.send('tabs:create', {});
    else if (action === 'Bookmarks') openPanel('bookmarks', 'Bookmarks');
    else if (action === 'History') openPanel('history', 'History');
    else if (action === 'Downloads') openPanel('downloads', 'Downloads');
    else if (action === 'Refresh') { const id = activeId; if (id) api.send('tabs:reload', id); }
    else if (action === 'Settings') openPanel('settings', 'Settings');
  }
  function openMenu() { buildMenu(); menuBackdrop.classList.add('open'); sideMenu.classList.add('open'); }
  function closeMenu() { menuBackdrop.classList.remove('open'); sideMenu.classList.remove('open'); }

  /* ── Panels ────────────────────────────────────────────────── */
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
    panelBody.appendChild(row(i18n.t('settings.language'), sel(avail.map(l => ({ v: l, l: l.toUpperCase() })), cfg.language, async v => { await api.invoke('settings:set', 'language', v); await i18n.loadFor(v); applyI18n(); renderSettings(); })));
    panelBody.appendChild(row(i18n.t('settings.searchEngine'), sel([{ v: 'google', l: 'Google' }, { v: 'bing', l: 'Bing' }, { v: 'duckduckgo', l: 'DuckDuckGo' }], cfg.searchEngine, v => api.invoke('settings:set', 'searchEngine', v))));
    panelBody.appendChild(row(i18n.t('settings.homePage'), (() => { const i = document.createElement('input'); i.className = 'setting-input'; i.value = cfg.homePage || ''; i.addEventListener('change', () => api.invoke('settings:set', 'homePage', i.value.trim())); return i; })()));

    panelBody.appendChild(sec('Ad Blocking'));
    panelBody.appendChild(row(i18n.t('settings.adblockEnabled'), sw(cfg.adblock.enabled, v => { cfg.adblock.enabled = v; api.invoke('settings:set', 'adblock', cfg.adblock); })));
    const st = await api.invoke('adblock:getStats').catch(() => null);
    if (st) panelBody.appendChild(row(i18n.t('settings.adblockStats'), '<span style="color:var(--accent)">' + st.blocked + '</span>'));

    panelBody.appendChild(sec('Downloads'));
    panelBody.appendChild(row(i18n.t('settings.askWhereToSave'), sw(cfg.askWhereToSave, v => api.invoke('settings:set', 'askWhereToSave', v))));

    panelBody.appendChild(sec('Clear Data'));
    const clrBtn = document.createElement('button'); clrBtn.className = 'btn'; clrBtn.textContent = i18n.t('settings.clearHistory');
    clrBtn.addEventListener('click', async () => { if (confirm(i18n.t('dialog.clearHistory'))) { await api.invoke('history:clear'); showToast('History cleared'); } });
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
    const save = (h, r) => { api.invoke('site:setRule', h, r); showToast('Saved'); };
    for (const [lbl, rk] of [['Ad blocking', 'adblockEnabled'], ['JavaScript', 'javascript'], ['Pop-ups', 'popups']]) {
      panelBody.appendChild(row(lbl, sw(rule[rk] || false, v => { rule[rk] = v; save(host, rule); })));
    }
    const uaRow = document.createElement('div'); uaRow.className = 'mg-item'; uaRow.style.flexDirection = 'column'; uaRow.style.alignItems = 'stretch';
    const uaIn = document.createElement('textarea'); uaIn.className = 'setting-input'; uaIn.value = rule.userAgent || ''; uaIn.placeholder = i18n.t('site.default');
    uaIn.addEventListener('change', () => { const v = uaIn.value.trim(); if (v) rule.userAgent = v; else delete rule.userAgent; save(host, rule); });
    const uaLabel = document.createElement('div'); uaLabel.style.cssText = 'font-size:11px;color:var(--fg-dim);margin-bottom:6px'; uaLabel.textContent = 'User Agent';
    uaRow.appendChild(uaLabel); uaRow.appendChild(uaIn);
    panelBody.appendChild(uaRow);
  }

  /* ── Event wiring ──────────────────────────────────────────── */

  // Bottom nav buttons
  $('navBack').addEventListener('click', () => { if (activeId) api.send('tabs:goBack', activeId); });
  $('navForward').addEventListener('click', () => { if (activeId) api.send('tabs:goForward', activeId); });
  $('navHome').addEventListener('click', () => {
    homeEl.classList.remove('hidden');
    urlBar.style.display = 'none';
    homeInput.value = '';
    setTimeout(() => homeInput.focus(), 100);
  });
  $('navTabs').addEventListener('click', () => {
    if (allTabs.length > 1) {
      const nextIdx = (allTabs.findIndex(t => t.id === activeId) + 1) % allTabs.length;
      api.send('tabs:setActive', allTabs[nextIdx].id);
    }
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

  // macOS window controls
  $('btnClose').addEventListener('click', () => api.send('window:close'));
  $('btnMinimize').addEventListener('click', () => api.send('window:minimize'));
  $('btnMaximize').addEventListener('click', () => api.send('window:maximize'));

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const m = e.ctrlKey || e.metaKey;
    if (m) {
      if (e.key === 't') { e.preventDefault(); api.send('tabs:create', {}); }
      if (e.key === 'l') { e.preventDefault(); openUrlEdit(); }
      if (e.key === 'w') { e.preventDefault(); if (activeId) api.send('tabs:close', activeId); }
    }
  });

  // IPC events
  api.on('tabs:changed', (tabs, aid, url, title) => {
    allTabs = Array.isArray(tabs) ? tabs : [];
    activeId = aid || '';
    activeUrl = url || '';
    activeTitle = title || '';
    renderTabs();
    syncView();
  });

  /* ── Init ───────────────────────────────────────────────────── */
  (async () => {
    await i18n.init();
    applyI18n();
    try {
      const tabs = await api.invoke('tabs:getAll');
      const aid = await api.invoke('tabs:getActiveId');
      if (Array.isArray(tabs)) { allTabs = tabs; activeId = aid || ''; }
    } catch {}
    renderTabs();
    syncView();
    homeInput.focus();
  })();
})();
