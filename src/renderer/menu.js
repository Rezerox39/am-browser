'use strict';
(() => {
  const api = window.am;
  if (!api) return;

  const $ = (id) => document.getElementById(id);
  const backdrop = $('backdrop');
  const sideMenu = $('side-menu');
  const sideMenuGrid = $('side-menu-grid');
  const panel = $('panel');
  const panelTitle = $('panel-title');
  const panelBody = $('panel-body');
  const panelAction = $('panel-action');
  const panelSearch = $('panel-search');
  const toastEl = $('toast');

  let currentPanel = '';
  let activeUrl = '';

  /* ── Helpers ─────────────────────────────────────────────── */
  async function safeInvoke(ch, ...a) {
    try { return await api.invoke(ch, ...a); } catch { return undefined; }
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }
  function fmtBytes(b) {
    if (!b || isNaN(b)) return '0 B';
    const u = ['B','KB','MB','GB']; let i = 0, n = b;
    while (n >= 1024 && i < 3) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  /* ── Side menu ───────────────────────────────────────────── */
  const MENU_ITEMS = [
    { label: 'New Tab', action: 'createTab' },
    { label: 'Bookmarks', action: 'panel', panel: 'bookmarks', title: 'Bookmarks' },
    { label: 'History', action: 'panel', panel: 'history', title: 'History' },
    { label: 'Downloads', action: 'panel', panel: 'downloads', title: 'Downloads' },
    { label: 'Refresh', action: 'refresh' },
    { label: 'Settings', action: 'panel', panel: 'settings', title: 'Settings' },
    { label: 'Site Settings', action: 'panel', panel: 'siteSettings', title: 'Site Settings' },
  ];

  const ICONS = {
    'New Tab': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'Bookmarks': '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    'History': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'Downloads': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'Refresh': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    'Settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'Site Settings': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>',
  };

  function buildMenu() {
    sideMenuGrid.innerHTML = '';
    MENU_ITEMS.forEach(item => {
      const el = document.createElement('div');
      el.className = 'sheet-item';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">' + (ICONS[item.label] || '') + '</svg><span>' + item.label + '</span>';
      el.addEventListener('click', () => handleAction(item));
      sideMenuGrid.appendChild(el);
    });
  }

  function handleAction(item) {
    if (item.action === 'createTab') {
      safeInvoke('tabs:create', {});
      closeOverlay();
    } else if (item.action === 'refresh') {
      safeInvoke('tabs:reload');
      closeOverlay();
    } else if (item.action === 'panel') {
      openPanel(item.panel, item.title);
    }
  }

  function closeOverlay() {
    backdrop.classList.remove('open');
    sideMenu.classList.remove('open');
    panel.classList.remove('open');
    currentPanel = '';
    panelBody.innerHTML = '';
    panelTitle.textContent = '';
    // Ask the main process to slide the overlay view off-screen
    safeInvoke('ui:closeMenu');
  }

  /* ── Panel (settings / history / etc.) ───────────────────── */
  function openPanel(type, title) {
    panelTitle.textContent = title;
    panelAction.innerHTML = '';
    panelSearch.classList.add('hidden');
    panelSearch.value = '';
    if (type === 'history') panelSearch.classList.remove('hidden');
    sideMenu.classList.remove('open');
    panel.classList.add('open');
    currentPanel = type;
    loadPanel();
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
    } catch { return empty('Error'); }
    if (!items.length) return empty('No history yet.');
    panelBody.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<div class="pi-title">' + (it.title || it.url) + '</div><div class="pi-url">' + it.url + '</div>';
      d.addEventListener('click', () => { safeInvoke('tabs:navigate', null, it.url); closeOverlay(); });
      panelBody.appendChild(d);
    }
  }

  async function renderBookmarks() {
    let items;
    try { items = await safeInvoke('bookmarks:getAll'); if (!Array.isArray(items)) items = []; } catch { return empty('Error'); }
    if (!items.length) return empty('No bookmarks yet.');
    panelBody.innerHTML = '';
    for (const bm of items) {
      const d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<div class="pi-title">' + (bm.title || bm.url) + '</div><div class="pi-url">' + bm.url + '</div><span class="pi-del">✕</span>';
      d.addEventListener('click', () => { safeInvoke('tabs:navigate', null, bm.url); closeOverlay(); });
      d.querySelector('.pi-del').addEventListener('click', async e => { e.stopPropagation(); await safeInvoke('bookmarks:remove', bm.id); renderBookmarks(); });
      panelBody.appendChild(d);
    }
  }

  async function renderDownloads() {
    let items;
    try { items = await safeInvoke('downloads:getAll'); if (!Array.isArray(items)) items = []; } catch { return empty('Error'); }
    if (!items.length) return empty('No downloads yet.');
    panelBody.innerHTML = '';
    for (const dl of items) {
      const st = dl.state === 'progressing' ? 'Downloading...' : dl.state === 'failed' ? 'Failed' : 'Complete';
      const d = document.createElement('div'); d.className = 'dl-item';
      d.innerHTML = '<div class="dl-name">' + dl.filename + '</div><div class="dl-meta">' + st + ' · ' + fmtBytes(dl.receivedBytes || dl.totalBytes) + '</div><div class="dl-actions"><button>Open</button><button>Remove</button></div>';
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

    panelBody.appendChild(sec('Language'));
    const sel = document.createElement('select'); sel.className = 'setting-sel';
    (avail || []).forEach(loc => { const o = document.createElement('option'); o.value = loc; o.textContent = loc.toUpperCase(); if (loc === cfg.language) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', async () => { await safeInvoke('settings:set', 'language', sel.value); toast('Language: ' + sel.value); });
    panelBody.appendChild(item('Language', sel));

    panelBody.appendChild(sec('Search Engine'));
    const engSel = document.createElement('select'); engSel.className = 'setting-sel';
    [{k:'google',v:'Google'},{k:'duckduckgo',v:'DuckDuckGo'},{k:'bing',v:'Bing'}].forEach(({k,v}) => { const o = document.createElement('option'); o.value = k; o.textContent = v; if (k === cfg.searchEngine) o.selected = true; engSel.appendChild(o); });
    engSel.addEventListener('change', async () => { await safeInvoke('settings:set', 'searchEngine', engSel.value); toast('Search: ' + engSel.value); });
    panelBody.appendChild(item('Search Engine', engSel));

    panelBody.appendChild(sec('Ad Blocking'));
    const abSw = document.createElement('div'); abSw.className = 'switch' + (cfg.adblock?.enabled ? ' on' : '');
    abSw.addEventListener('click', async () => { abSw.classList.toggle('on'); await safeInvoke('settings:set', 'adblock', { ...cfg.adblock, enabled: abSw.classList.contains('on') }); toast(abSw.classList.contains('on') ? 'Adblock ON' : 'Adblock OFF'); });
    panelBody.appendChild(item('Enable Ad Blocking', abSw));

    panelBody.appendChild(sec('Clear Data'));
    const clrBtn = document.createElement('button'); clrBtn.className = 'btn'; clrBtn.textContent = 'Clear History';
    clrBtn.addEventListener('click', async () => { if (confirm('Clear all history?')) { await safeInvoke('history:clear'); toast('History cleared'); } });
    panelBody.appendChild(clrBtn);
  }

  async function renderSiteSettings() {
    activeUrl = (await safeInvoke('tabs:getCurrentUrl'))?.url || '';
    if (!activeUrl) return empty('No site loaded');
    let host; try { host = new URL(activeUrl).hostname; } catch { return empty('—'); }
    let rule; try { rule = await safeInvoke('site:getRule', host); } catch { rule = {}; }
    rule = rule || {};
    panelBody.innerHTML = '';
    const hostEl = document.createElement('div'); hostEl.className = 'mg-item';
    hostEl.innerHTML = '<label style="font-family:monospace;font-size:12px;color:var(--accent)">' + host + '</label>';
    panelBody.appendChild(hostEl);
    const sw = (on, cb) => { const el = document.createElement('div'); el.className = 'switch' + (on ? ' on' : ''); el.addEventListener('click', () => { el.classList.toggle('on'); cb(el.classList.contains('on')); }); return el; };
    const row = (lbl, ctrl) => { const el = document.createElement('div'); el.className = 'mg-item'; el.innerHTML = '<label>' + lbl + '</label>'; el.appendChild(ctrl); return el; };
    for (const [lbl, rk] of [['Ad Blocking', 'adblockEnabled'], ['JavaScript', 'javascript'], ['Pop-ups', 'popups']]) {
      panelBody.appendChild(row(lbl, sw(rule[rk] || false, async v => { rule[rk] = v; await safeInvoke('site:setRule', host, rule); toast('Saved'); })));
    }
    const uaInput = document.createElement('input');
    uaInput.className = 'setting-input'; uaInput.type = 'text';
    uaInput.placeholder = 'Custom user agent (optional)';
    uaInput.value = rule.userAgent || '';
    uaInput.addEventListener('change', async () => { rule.userAgent = uaInput.value.trim() || ''; await safeInvoke('site:setRule', host, rule); toast('Saved'); });
    panelBody.appendChild(row('User Agent', uaInput));
  }

  /* ── Event wiring ────────────────────────────────────────── */
  backdrop.addEventListener('click', closeOverlay);
  $('menu-close-btn').addEventListener('click', closeOverlay);
  $('panel-back').addEventListener('click', closeOverlay);
  panelSearch.addEventListener('input', loadPanel);
  $('sm-history').addEventListener('click', () => openPanel('history', 'History'));
  $('sm-bookmarks').addEventListener('click', () => openPanel('bookmarks', 'Bookmarks'));
  $('sm-downloads').addEventListener('click', () => openPanel('downloads', 'Downloads'));
  $('sm-settings').addEventListener('click', () => openPanel('settings', 'Settings'));

  /* ── IPC events from main process ────────────────────────── */
  api.on('menu:changed', () => loadPanel());

  // When the main process opens/closes the menu overlay view (sliding it in/out),
  // toggle the DOM classes on side-menu, backdrop, and panel so CSS transitions work.
  api.on('menu:state', (isOpen) => {
    if (isOpen) {
      backdrop.classList.add('open');
      sideMenu.classList.add('open');
    } else {
      backdrop.classList.remove('open');
      sideMenu.classList.remove('open');
      panel.classList.remove('open');
      currentPanel = '';
      panelBody.innerHTML = '';
      panelTitle.textContent = '';
    }
  });

  /* ── Build initial menu ──────────────────────────────────── */
  buildMenu();
})();
