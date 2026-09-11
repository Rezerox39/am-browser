'use strict';
(() => {
  const api = window.am;
  if (!api) { document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-size:16px">Preload unavailable</div>'; return; }
  const $ = id => document.getElementById(id);

  const i18n = { s: {} };
  async function initI18n() {
    try { const s = await api.invoke('i18n:getStrings'); if (s && typeof s === 'object') i18n.s = s; } catch {}
    try {
      const cfg = await api.invoke('settings:get');
      if (cfg.language && cfg.language !== 'en') {
        await api.invoke('i18n:setLocale', cfg.language);
        const l = await api.invoke('i18n:getStrings');
        if (l && typeof l === 'object') i18n.s = l;
      }
      if (cfg.searchEngine) searchEngine = cfg.searchEngine;
    } catch {}
  }
  function t(k) { return i18n.s[k] || k; }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.getAttribute('data-i18n'); if (k) el.textContent = t(k); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const k = el.getAttribute('data-i18n-placeholder'); if (k) el.placeholder = t(k); });
  }

  let allTabs = [], activeId = '', activeUrl = '', activeTitle = '';
  let _showingHome = true;
  let searchEngine = 'google';

  const tabStrip = $('tabStrip'), tabCount = $('tabCount');
  const urlBar = $('urlBar'), urlBarText = $('urlBarText');
  const urlEditBar = $('urlEditBar'), urlInput = $('urlInput');
  const homeEl = $('home'), homeInput = $('home-input');
  // Menu/panel UI is now a separate WebContentsView overlay (menu.html).
  // These DOM elements no longer exist in index.html.
  let _menuOpen = false;

  function favicon(url) { try { return new URL(url).hostname[0]?.toUpperCase() || '?'; } catch { return '?'; } }
  function faviconUrl(url) { try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=32'; } catch { return ''; } }
  function fmtBytes(b) { if (!b || isNaN(b)) return '0 B'; const u = ['B','KB','MB','GB']; let i = 0, n = b; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function toast(msg) {
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function escapeHtml(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  async function safeInvoke(ch, ...a) { try { return await api.invoke(ch, ...a); } catch (e) { console.error('[AM] IPC:', ch, e); return undefined; } }

  function searchUrl(q) {
    const engines = {
      google: 'https://www.google.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q=',
      bing: 'https://www.bing.com/search?q=',
    };
    return (engines[searchEngine] || engines.google) + encodeURIComponent(q);
  }
  function normalize(v) {
    const s = v.trim(); if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) return 'https://' + s;
    return searchUrl(s);
  }

  async function navigate(url) {
    const id = activeId || await safeInvoke('tabs:getActiveId');
    if (!id) { toast('No active tab'); return; }
    await safeInvoke('tabs:navigate', id, url);
  }

  function syncView(mode) {
    const contentMode = mode === 'content';
    _showingHome = !contentMode;
    if (contentMode) {
      homeEl.classList.add('hidden');
      urlBar.style.display = 'flex';
      urlBarText.textContent = activeTitle || activeUrl;
      urlEditBar.classList.add('hidden');
    } else {
      homeEl.classList.remove('hidden');
      urlBar.style.display = 'none';
      urlEditBar.classList.add('hidden');
    }
  }

  function enterHome() {
    _showingHome = true;
    activeUrl = '';
    homeEl.classList.remove('hidden');
    urlBar.style.display = 'none';
    urlEditBar.classList.add('hidden');
    // Hide loading bar on home screen
    const bar = document.getElementById('loadingBar');
    if (bar) { bar.classList.remove('active', 'complete'); }
    // Hide the WebContentsView so the home screen is not covered by the page
    safeInvoke('tabs:showHome');
    setTimeout(() => homeInput.focus(), 50);
  }

  function renderTabs() {
    tabStrip.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'tab-chip' + (tab.id === activeId ? ' active' : '');
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-label', (tab.title || 'New Tab') + (tab.loading ? ' (loading)' : ''));
      el.setAttribute('tabindex', '0');
      el.innerHTML =
        (function() {
        const favUrl = tab.url ? faviconUrl(tab.url) : '';
        return favUrl
          ? '<img class="tc-favicon-img" src="' + favUrl + '" width="14" height="14" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;" /><span class="tc-favicon tc-fallback" style="display:none">' + favicon(tab.url) + '</span>'
          : '<span class="tc-favicon">' + favicon(tab.url) + '</span>';
      })() +
        '<span class="tc-title">' + (tab.title || 'New Tab') + '</span>' +
        '<span class="tc-close">✕</span>';
      el.querySelector('.tc-close').addEventListener('click', e => { e.stopPropagation(); safeInvoke('tabs:close', tab.id); });
      el.addEventListener('click', () => { if (tab.id !== activeId) safeInvoke('tabs:setActive', tab.id); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tab.id !== activeId) safeInvoke('tabs:setActive', tab.id); } });
      tabStrip.appendChild(el);
    }
    const addBtn = document.createElement('div');
    addBtn.className = 'tab-chip tc-add';
    addBtn.setAttribute('role', 'button');
    addBtn.setAttribute('aria-label', 'New tab');
    addBtn.setAttribute('tabindex', '0');
    addBtn.innerHTML = '<span class="tc-plus">+</span>';
    addBtn.addEventListener('click', () => safeInvoke('tabs:create', {}));
    tabStrip.appendChild(addBtn);
    if (tabCount) tabCount.textContent = allTabs.length || 1;
  }

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
    if (e.key === 'Enter') { const url = normalize(urlInput.value); if (url) navigate(url); closeUrlEdit(); }
    if (e.key === 'Escape') closeUrlEdit();
    e.stopPropagation();
  });
  urlInput.addEventListener('blur', () => setTimeout(closeUrlEdit, 200));

  homeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = homeInput.value.trim(); if (!val) return;
      const url = normalize(val);
      homeInput.value = ''; homeInput.blur();
      if (url) navigate(url);
    }
    if (e.key === 'Escape') homeInput.blur();
    e.stopPropagation();
  });
  homeEl.addEventListener('click', e => { if (e.target !== homeInput) setTimeout(() => homeInput.focus(), 20); });

  // Menu/panel logic is now in a separate WebContentsView (menu.html).
  // The chrome renderer only forwards ESC to the main process overlay.
  

  // The floating nav pill lives in its own transparent overlay view
  // (src/renderer/pill.html). The chrome window reacts to it via IPC bridges.
  api.on('ui:showHome', () => enterHome());
  api.on('menu:state', (isOpen) => {
    _menuOpen = isOpen;
    document.body.classList.toggle('am-menu-open', !!isOpen);
  });
  api.on('ui:esc', () => { if (_menuOpen) safeInvoke('ui:openMenu'); });
  api.on('ui:fullscreen', (on) => {
    document.body.classList.toggle('am-fullscreen', !!on);
    if (on && _menuOpen) safeInvoke('ui:openMenu');
  });
  $('btnClose').addEventListener('click', async () => { try { await safeInvoke('window:close'); } catch {} });
  $('btnMinimize').addEventListener('click', async () => { try { await safeInvoke('window:minimize'); } catch {} });
  $('btnMaximize').addEventListener('click', async () => { try { await safeInvoke('window:maximize'); } catch {} });
  document.addEventListener('keydown', e => {
    const m = e.ctrlKey || e.metaKey;
    if (m && e.key === 't') { e.preventDefault(); safeInvoke('tabs:create', {}); }
    if (m && e.key === 'l') { e.preventDefault(); openUrlEdit(); }
    if (m && e.key === 'w') { e.preventDefault(); if (activeId) safeInvoke('tabs:close', activeId); }
    if (e.key === 'Escape') { if (_menuOpen) safeInvoke('ui:openMenu'); }
  });

  api.on('tabs:changed', (tabs, aid, url, title, mode) => {
    allTabs = Array.isArray(tabs) ? tabs : [];
    activeId = aid || '';
    activeUrl = url || '';
    activeTitle = title || '';
    renderTabs();
    syncView(mode || (url ? 'content' : 'home'));
    updateLoadingBar();
  });
  function updateLoadingBar() {
    const bar = document.getElementById('loadingBar');
    if (!bar) return;
    const active = allTabs.find(t => t.id === activeId);
    if (active && active.loading) {
      bar.classList.remove('complete');
      bar.classList.add('active');
    } else if (bar.classList.contains('active')) {
      bar.classList.remove('active');
      bar.classList.add('complete');
      setTimeout(() => bar.classList.remove('complete'), 300);
    }
  }

  api.on('tabs:focusAddressBar', () => openUrlEdit());
  api.on('window:maximized', isMax => {
    const dot = $('btnMaximize');
    if (dot) {
      dot.title = isMax ? 'Restore' : 'Maximize';
      dot.classList.toggle('is-restored', !!isMax);
    }
  });


  // ── Download notification bar ────────────────────────────────
  const dlBar = $('downloadBar');
  let dlAutoHide = null;
  api.on('downloads:changed', (downloads) => {
    if (!dlBar || !Array.isArray(downloads)) return;
    const active = downloads.filter(d => d.state === 'progressing');
    const recent = downloads.filter(d => d.state === 'complete' || d.state === 'failed' || d.state === 'cancelled');
    const latest = downloads[0];
    if (!latest) { dlBar.classList.add('hidden'); return; }

    if (active.length > 0) {
      // Show progress bar
      const a = active[0];
      const pct = a.totalBytes > 0 ? Math.min(100, Math.round((a.receivedBytes / a.totalBytes) * 100)) : 0;
      dlBar.classList.remove('hidden', 'complete', 'failed');
      dlBar.classList.add('active');
      dlBar.innerHTML = '<div class="dl-bar-inner">' +
        '<div class="dl-bar-info">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          '<span class="dl-bar-name">' + escapeHtml(a.filename) + '</span>' +
          '<span class="dl-bar-pct">' + pct + '%</span>' +
        '</div>' +
        '<div class="dl-bar-track"><div class="dl-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
      clearTimeout(dlAutoHide);
    } else if (latest.state === 'complete') {
      dlBar.classList.remove('hidden', 'active');
      dlBar.classList.add('complete');
      dlBar.innerHTML = '<div class="dl-bar-inner">' +
        '<div class="dl-bar-info">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
          '<span class="dl-bar-name">' + escapeHtml(latest.filename) + '</span>' +
          '<span class="dl-bar-status">Downloaded</span>' +
        '</div>' +
      '</div>';
      dlAutoHide = setTimeout(() => dlBar.classList.add('hidden'), 4000);
    } else if (latest.state === 'failed' || latest.state === 'cancelled') {
      dlBar.classList.remove('hidden', 'active', 'complete');
      dlBar.classList.add('failed');
      dlBar.innerHTML = '<div class="dl-bar-inner">' +
        '<div class="dl-bar-info">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
          '<span class="dl-bar-name">' + escapeHtml(latest.filename) + '</span>' +
          '<span class="dl-bar-status">' + (latest.state === 'cancelled' ? 'Cancelled' : 'Failed') + '</span>' +
        '</div>' +
      '</div>';
      dlAutoHide = setTimeout(() => dlBar.classList.add('hidden'), 4000);
    }
  });

  (async () => {
    await initI18n(); applyI18n();
    try {
      const tabs = await safeInvoke('tabs:getAll');
      const aid = await safeInvoke('tabs:getActiveId');
      if (Array.isArray(tabs)) allTabs = tabs;
      if (aid) activeId = aid;
    } catch {}
    renderTabs();
    _showingHome = true;
    homeEl.classList.remove('hidden');
    urlBar.style.display = 'none';
    urlEditBar.classList.add('hidden');
    
    setTimeout(() => homeInput.focus(), 100);
  })();
})();
