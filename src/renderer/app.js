'use strict';

(() => {
  const api = window.am;
  if (!api) { document.body.innerHTML = '<h1 style="color:#fff;padding:40px">Preload unavailable</h1>'; return; }

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
  const applyI18n = () => {
    document.querySelectorAll('[data-i18n]').forEach(e => { const k = e.getAttribute('data-i18n'); if (k) e.textContent = i18n.t(k); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(e => { const k = e.getAttribute('data-i18n-placeholder'); if (k) e.placeholder = i18n.t(k); });
  };

  /* ── Refs ──────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const urlInput = $('urlInput'), omniboxLock = $('omniboxLock');
  const tabStrip = $('tabStrip');
  const menuBackdrop = $('menu-backdrop'), sideMenu = $('side-menu'), sideMenuGrid = $('side-menu-grid');
  const panelBackdrop = $('panel-backdrop'), panel = $('panel'), panelTitle = $('panel-title'), panelBody = $('panel-body'), panelAction = $('panel-action'), panelSearch = $('panel-search');
  const homeEl = $('home');
  let allTabs = [], activeId = '', activeUrl = '', activeTitle = '';
  let currentPanel = '', lastPanelType = '';

  /* ── Icons (Feather-style inline SVGs) ─────────────────────── */
  const IC = {
    globe: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    back: '<polyline points="15 18 9 12 15 6"/>',
    forward: '<polyline points="9 18 15 12 9 6"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    newTab: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    history: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    downloads: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    tab: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
    scripts: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">' + (IC[name]||IC.globe) + '</svg>'; }

  /* ── Helpers ───────────────────────────────────────────────── */
  const favicon = url => { try { return new URL(url).hostname[0]?.toUpperCase()||'?'; } catch { return '?'; } };
  const fmtBytes = b => { if (!b||isNaN(b)) return '0 B'; const u=['B','KB','MB','GB']; let i=0,n=b; while(n>=1024&&i<3){n/=1024;i++;} return n.toFixed(i?1:0)+' '+u[i]; };

  /* ── Tab strip ─────────────────────────────────────────────── */
  function renderTabs() {
    tabStrip.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'tab-chip' + (tab.id === activeId ? ' active' : '');
      el.addEventListener('click', () => api.invoke('tabs:setActive', tab.id));
      el.innerHTML = '<span>' + favicon(tab.url) + '</span><span class="tc-title">' + (tab.title || 'New Tab') + '</span>';
      const cls = document.createElement('span');
      cls.className = 'tc-close';
      cls.textContent = '✕';
      cls.addEventListener('click', e => { e.stopPropagation(); api.send('tabs:close', tab.id); });
      el.appendChild(cls);
      tabStrip.appendChild(el);
    }
  }
  function syncBar() {
    if (document.activeElement === urlInput) return;
    urlInput.value = activeUrl || '';
    omniboxLock.innerHTML = (activeUrl.startsWith('https://') || activeUrl.startsWith('am://'))
      ? svg('bookmark') : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><circle cx="12" cy="12" r="10"/></svg>';
    omniboxLock.style.color = activeUrl.startsWith('https://') ? 'var(--accent)' : 'var(--fg-dim)';
    homeEl.classList.toggle('hidden', activeUrl !== '');
  }

  /* ── Panels (Via slide-in) ────────────────────────────────── */
  function openPanel(type, title) {
    lastPanelType = type;
    panelTitle.textContent = title;
    panelAction.innerHTML = '';
    panelSearch.classList.add('hidden');
    if (type === 'history') {
      panelSearch.classList.remove('hidden');
      panelSearch.value = '';
      panelAction.innerHTML = svg('bookmark');
      panelAction.onclick = closePanel;
    } else if (type === 'bookmarks') {
      panelAction.innerHTML = svg('bookmark');
      panelAction.onclick = closePanel;
    } else if (type === 'downloads') {
      panelAction.innerHTML = svg('downloads');
      panelAction.onclick = closePanel;
    } else if (type === 'settings') {
      panelAction.innerHTML = svg('settings');
      panelAction.onclick = closePanel;
    } else if (type === 'siteSettings') {
      panelAction.innerHTML = svg('settings');
      panelAction.onclick = closePanel;
    }
    panelBackdrop.classList.add('open');
    panel.classList.add('open');
    currentPanel = type;
    closeMenu();
    refreshPanel();
  }
  function closePanel() {
    panelBackdrop.classList.remove('open');
    panel.classList.remove('open');
    currentPanel = '';
  }
  async function refreshPanel() {
    const tb = currentPanel;
    if (tb === 'history') return renderHistory();
    if (tb === 'bookmarks') return renderBookmarks();
    if (tb === 'downloads') return renderDownloads();
    if (tb === 'settings') return renderSettings();
    if (tb === 'siteSettings') return renderSiteSettings();
  }

  function empty(msg) { panelBody.innerHTML = '<div class="empty-state">' + msg + '</div>'; }

  async function renderHistory() {
    const q = panelSearch.value.trim();
    let items; try { items = q ? await api.invoke('history:search',q,50) : await api.invoke('history:getRecent',100); } catch { return empty('Error'); }
    if (!items.length) return empty(i18n.t('history.empty'));
    panelBody.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div'); d.className = 'pi'; d.innerHTML = '<div class="pi-title">' + (it.title||it.url) + '</div><div class="pi-url">' + it.url + '</div>';
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
      d.innerHTML = '<div class="pi-title">' + (bm.title||bm.url) + '</div><div class="pi-url">' + bm.url + '</div><span class="pi-del">✕</span>';
      d.addEventListener('click', () => { navigate(bm.url); closePanel(); });
      d.querySelector('.pi-del').addEventListener('click', async e => { e.stopPropagation(); await api.invoke('bookmarks:remove',bm.id); renderBookmarks(); });
      panelBody.appendChild(d);
    }
  }

  async function renderDownloads() {
    let items; try { items = await api.invoke('downloads:getAll'); } catch { return empty('Error'); }
    if (!items.length) return empty(i18n.t('downloads.empty'));
    panelBody.innerHTML = '';
    for (const dl of items) {
      const stateStr = dl.state === 'progressing' ? 'Downloading...' : dl.state === 'failed' ? 'Failed' : dl.state === 'cancelled' ? 'Cancelled' : 'Complete';
      const d = document.createElement('div'); d.className = 'dl-item';
      d.innerHTML = '<div class="dl-name">' + dl.filename + '</div><div class="dl-meta">' + stateStr + ' · ' + fmtBytes(dl.receivedBytes||dl.totalBytes) + '</div><div class="dl-actions"><button>Open</button><button>Remove</button></div>';
      d.querySelectorAll('button')[0].addEventListener('click', () => { if (dl.state==='complete'&&dl.savePath) api.invoke('downloads:openFile',dl.savePath); });
      d.querySelectorAll('button')[1].addEventListener('click', async () => { await api.invoke('downloads:remove',dl.id); renderDownloads(); });
      panelBody.appendChild(d);
    }
  }

  async function renderSettings() {
    const cfg = await api.invoke('settings:get');
    const avail = await api.invoke('i18n:getAvailable');
    panelBody.innerHTML = '';
    const sec = t => { const el = document.createElement('div'); el.className='sec-title'; el.textContent=t; return el; };
    const row = (lbl, ctrl) => { const el=document.createElement('div'); el.className='mg-item'; el.innerHTML='<label>'+lbl+'</label>'; el.appendChild(typeof ctrl==='string'?Object.assign(document.createElement('span'),{className:'sub',innerHTML:ctrl}):ctrl); return el; };
    const sw = (id,on,cb) => { const el=document.createElement('div'); el.className='switch'+(on?' on':''); el.id=id; el.addEventListener('click',()=>{el.classList.toggle('on');cb(el.classList.contains('on'));}); return el; };
    const sel = (opts,val,cb) => { const s=document.createElement('select'); s.className='setting-sel'; opts.forEach(o=>{const op=document.createElement('option');op.value=o.v;op.textContent=o.l;if(o.v===val)op.selected=true;s.appendChild(op);}); s.addEventListener('change',()=>cb(s.value)); return s; };
    const ti = (val,cb) => { const i=document.createElement('input'); i.className='setting-input'; i.value=val||''; i.addEventListener('change',()=>cb(i.value.trim())); return i; };

    panelBody.appendChild(sec('General'));
    panelBody.appendChild(row(i18n.t('settings.language'), sel(avail.map(l=>({v:l,l:l.toUpperCase()})), cfg.language, async v=>{ await api.invoke('settings:set','language',v); await i18n.loadFor(v); applyI18n(); renderSettings(); })));
    panelBody.appendChild(row(i18n.t('settings.searchEngine'), sel([{v:'google',l:'Google'},{v:'bing',l:'Bing'},{v:'duckduckgo',l:'DuckDuckGo'}], cfg.searchEngine, v=>api.invoke('settings:set','searchEngine',v))));

    panelBody.appendChild(sec('Ad Blocking'));
    panelBody.appendChild(row(i18n.t('settings.adblockEnabled'), sw('ablk', cfg.adblock.enabled, v=>{ cfg.adblock.enabled=v; api.invoke('settings:set','adblock',cfg.adblock); })));
    const st = await api.invoke('adblock:getStats').catch(()=>null);
    if (st) panelBody.appendChild(row(i18n.t('settings.adblockStats'), '<span style="color:var(--accent)">'+st.blocked+'</span>'));

    panelBody.appendChild(sec('Downloads'));
    panelBody.appendChild(row(i18n.t('settings.askWhereToSave'), sw('ask', cfg.askWhereToSave, v=>api.invoke('settings:set','askWhereToSave',v))));

    panelBody.appendChild(sec('Clear Data'));
    const b = document.createElement('button'); b.className='btn'; b.textContent=i18n.t('settings.clearHistory');
    b.addEventListener('click', async()=>{ if(confirm(i18n.t('dialog.clearHistory'))){ await api.invoke('history:clear'); toast('History cleared'); }});
    panelBody.appendChild(b);
  }

  async function renderSiteSettings() {
    if (!activeUrl) { empty('No site loaded'); return; }
    let host; try { host = new URL(activeUrl).hostname; } catch { empty('—'); return; }
    let rule; try { rule = await api.invoke('site:getRule',host); } catch { rule={}; }
    rule = rule || {};
    panelBody.innerHTML = '<div class="mg-item" style="color:var(--accent)"><label style="font-family:monospace;font-size:12px">' + host + '</label></div>';
    const sw = (id,on,cb) => { const el=document.createElement('div'); el.className='switch'+(on?' on':''); el.id=id; el.addEventListener('click',()=>{el.classList.toggle('on');cb(el.classList.contains('on'));}); return el; };
    const row = (lbl, ctrl) => { const el=document.createElement('div'); el.className='mg-item'; el.innerHTML='<label>'+lbl+'</label>'; el.appendChild(ctrl); return el; };
    const save = (h,r) => { api.invoke('site:setRule',h,r); toast('Saved'); };
    for (const [lbl,rk] of [['Ad blocking','adblockEnabled'],['JavaScript','javascript'],['Pop-ups','popups']]) {
      const cv = rule[rk] !== undefined ? rule[rk] : false;
      panelBody.appendChild(row(lbl, sw(rk, cv, v=>{ rule[rk]=v; save(host,rule); })));
    }
    panelBody.appendChild(document.createElement('div')).className='sec-title';
    const uaRow = document.createElement('div'); uaRow.className='mg-item';
    const uaIn = document.createElement('textarea'); uaIn.className='setting-input'; uaIn.value=rule.userAgent||''; uaIn.placeholder=i18n.t('site.default');
    uaIn.style.width='100%'; uaIn.style.minHeight='56px';
    uaIn.addEventListener('change',()=>{ const v=uaIn.value.trim(); if(v) rule.userAgent=v; else delete rule.userAgent; save(host,rule); });
    uaRow.innerHTML='<label>User Agent</label>'; uaRow.appendChild(uaIn);
    panelBody.appendChild(uaRow);
  }

  /* ── Side menu (Via grid) ──────────────────────────────────── */
  const MENU_ITEMS = [
    { label:'New Tab', action:'newTab', icon: IC.newTab },
    { label:'Bookmarks', action:'bookmarks', icon: IC.bookmark },
    { label:'History', action:'history', icon: IC.history },
    { label:'Downloads', action:'downloads', icon: IC.downloads },
    { label:'Settings', action:'settings', icon: IC.settings },
    { label:'Refresh', action:'refresh', icon: IC.refresh },
  ];
  function buildMenu() {
    sideMenuGrid.innerHTML = '';
    MENU_ITEMS.forEach(item => {
      const el = document.createElement('div');
      el.className = 'sheet-item';
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24">' + item.icon + '</svg><span>' + item.label + '</span>';
      el.addEventListener('click', () => handleMenu(item.action));
      sideMenuGrid.appendChild(el);
    });
  }
  function handleMenu(action) {
    closeMenu();
    if (action === 'newTab') api.invoke('tabs:create', {});
    else if (action === 'bookmarks') openPanel('bookmarks', i18n.t('bookmarks.title'));
    else if (action === 'history') openPanel('history', i18n.t('history.title'));
    else if (action === 'downloads') openPanel('downloads', i18n.t('downloads.title'));
    else if (action === 'settings') openPanel('settings', i18n.t('settings.title'));
    else if (action === 'refresh') api.invoke('tabs:reload', activeId);
  }
  function openMenu() { buildMenu(); menuBackdrop.classList.add('open'); sideMenu.classList.add('open'); }
  function closeMenu() { menuBackdrop.classList.remove('open'); sideMenu.classList.remove('open'); }

  /* ── Navigation ────────────────────────────────────────────── */
  async function navigate(url) { const id = await api.invoke('tabs:getActiveId'); await api.invoke('tabs:navigate', id, url); }
  function normalize(v) {
    const s = v.trim(); if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }
  function doNavigate(val) { const url = normalize(val); if (url) navigate(url); }

  /* ── Events ────────────────────────────────────────────────── */
  // Omnibox
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { doNavigate(urlInput.value); urlInput.blur(); } });
  const homeInput = $('home-input');
  homeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { doNavigate(homeInput.value); homeInput.blur(); } });

  // Bottom nav
  $('navBack').addEventListener('click', () => api.invoke('tabs:goBack', activeId));
  $('navForward').addEventListener('click', () => api.invoke('tabs:goForward', activeId));
  $('navHome').addEventListener('click', () => { homeEl.classList.remove('hidden'); urlInput.focus(); });
  $('navNewTab').addEventListener('click', () => api.invoke('tabs:create', {}));
  $('navMenu').addEventListener('click', openMenu);

  // Menu footer shortcuts
  $('menu-history').addEventListener('click', () => handleMenu('history'));
  $('menu-bookmarks').addEventListener('click', () => handleMenu('bookmarks'));
  $('menu-downloads').addEventListener('click', () => handleMenu('downloads'));
  $('menu-settings').addEventListener('click', () => handleMenu('settings'));

  // Backdrop clicks
  menuBackdrop.addEventListener('click', closeMenu);
  panelBackdrop.addEventListener('click', closePanel);
  $('panel-back').addEventListener('click', closePanel);
  panelSearch.addEventListener('input', renderHistory);

  // Omnibox action → site settings
  $('omniboxAction').addEventListener('click', () => openPanel('siteSettings', i18n.t('site.title')));

  // Window controls
  $('btnMinimize').addEventListener('click', () => api.invoke('window:minimize'));
  $('btnMaximize').addEventListener('click', () => api.invoke('window:maximize'));
  $('btnClose').addEventListener('click', () => api.invoke('window:close'));

  /* ── Keyboard shortcuts ─────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const m = e.ctrlKey || e.metaKey;
    if (m) {
      if (e.key === 't') { e.preventDefault(); api.invoke('tabs:create',{}); }
      if (e.key === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); homeInput && homeInput.focus(); }
      if (e.key === 'w') { e.preventDefault(); api.invoke('tabs:close', activeId); }
    }
    if (e.alt && e.key === 'ArrowLeft') api.invoke('tabs:goBack', activeId);
    if (e.alt && e.key === 'ArrowRight') api.invoke('tabs:goForward', activeId);
  });

  /* ── IPC events ────────────────────────────────────────────── */
  api.on('tabs:changed', (tabs, aid, url, title) => {
    allTabs = tabs; activeId = aid; activeUrl = url||''; activeTitle = title||'';
    renderTabs(); syncBar();
  });
  api.on('window:maximized', ok => { $('btnMaximize').textContent = ok ? '❐' : '□'; });

  /* ── Toast ──────────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  window.__toast = toast;

  /* ── Init ───────────────────────────────────────────────────── */
  (async () => {
    await i18n.init();
    applyI18n();
    try {
      const tabs = await api.invoke('tabs:getAll');
      const aid = await api.invoke('tabs:getActiveId');
      if (Array.isArray(tabs)) { allTabs = tabs; activeId = aid; }
    } catch {}
    renderTabs(); syncBar();
  })();
})();
