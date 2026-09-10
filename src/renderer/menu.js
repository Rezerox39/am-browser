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
  function escapeHtml(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
    { label: 'Extensions', action: 'panel', panel: 'extensions', title: 'Extensions' },
    { label: 'Bookmarks', action: 'panel', panel: 'bookmarks', title: 'Bookmarks' },
    { label: 'History', action: 'panel', panel: 'history', title: 'History' },
    { label: 'Downloads', action: 'panel', panel: 'downloads', title: 'Downloads' },
    { label: 'Refresh', action: 'refresh' },
    { label: 'Adblock', action: 'toggleAdblock' },
    { label: 'Settings', action: 'panel', panel: 'settings', title: 'Settings' },
    { label: 'Site Settings', action: 'panel', panel: 'siteSettings', title: 'Site Settings' },
  ];

  const ICONS = {
    'New Tab': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'Extensions': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'Bookmarks': '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    'History': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'Downloads': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'Refresh': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    'Adblock': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    'Settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'Site Settings': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>',
  };

  let adblockEnabled = true;

  async function refreshAdblockState() {
    try {
      const cfg = await safeInvoke('settings:get');
      adblockEnabled = !!(cfg.adblock && cfg.adblock.enabled);
    } catch {}
    // Update the visual indicator on the adblock menu item
    const abEl = sideMenuGrid.querySelector('[data-action="toggleAdblock"]');
    if (abEl) {
      const dot = abEl.querySelector('.ab-dot');
      if (dot) dot.style.background = adblockEnabled ? '#28c840' : '#666';
    }
  }

  function buildMenu() {
    sideMenuGrid.innerHTML = '';
    MENU_ITEMS.forEach(item => {
      const el = document.createElement('div');
      el.className = 'sheet-item';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', item.label);
      el.setAttribute('tabindex', '0');
      el.setAttribute('data-action', item.action);
      let extra = '';
      if (item.action === 'toggleAdblock') {
        extra = '<span class="ab-dot" style="width:6px;height:6px;border-radius:50%;background:#28c840;position:absolute;top:8px;right:8px;transition:background 0.2s"></span>';
      }
      el.innerHTML = extra + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">' + (ICONS[item.label] || '') + '</svg><span>' + item.label + '</span>';
      el.addEventListener('click', () => handleAction(item));
      sideMenuGrid.appendChild(el);
    });
    refreshAdblockState();
  }

  async function toggleAdblock() {
    try {
      const cfg = await safeInvoke('settings:get');
      const enabled = !(cfg.adblock && cfg.adblock.enabled);
      await safeInvoke('settings:set', 'adblock', { ...(cfg.adblock || {}), enabled: enabled });
      toast(enabled ? 'Ad blocking ON' : 'Ad blocking OFF');
    } catch {}
  }

  function handleAction(item) {
    if (item.action === 'createTab') {
      safeInvoke('tabs:create', {});
      closeOverlay();
    } else if (item.action === 'refresh') {
      safeInvoke('tabs:reload');
      closeOverlay();
    } else if (item.action === 'toggleAdblock') {
      toggleAdblock();
    } else if (item.action === 'panel') {
      openPanel(item.panel, item.title);
    }
  }

  function closeOverlay() {
    stopDlPoll();
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
    if (currentPanel === 'extensions') return renderExtensions();
    if (currentPanel === 'history') return renderHistory();
    if (currentPanel === 'bookmarks') return renderBookmarks();
    if (currentPanel === 'downloads') return renderDownloads();
    if (currentPanel === 'settings') return renderSettings();
    if (currentPanel === 'siteSettings') return renderSiteSettings();
  }
  async function renderExtensions() {
    let exts = [];
    try { exts = await safeInvoke('extensions:getAll') || []; } catch {}
    panelBody.innerHTML = '';
    if (!Array.isArray(exts) || exts.length === 0) {
      panelBody.innerHTML = '<div class="empty-state">No extensions installed yet.<br><small style="color:var(--fg-dim)">Visit the Chrome Web Store to install extensions.</small></div>';
      const storeBtn = document.createElement('button');
      storeBtn.className = 'btn';
      storeBtn.textContent = 'Open Chrome Web Store';
      storeBtn.addEventListener('click', () => {
        safeInvoke('tabs:create', { url: 'https://chromewebstore.google.com/' });
        closeOverlay();
      });
      panelBody.appendChild(storeBtn);
      return;
    }
    const header = document.createElement('div');
    header.className = 'mg-item';
    header.innerHTML = '<label style="font-weight:600;font-size:14px">' + exts.length + ' extension' + (exts.length !== 1 ? 's' : '') + ' installed</label>';
    panelBody.appendChild(header);
    exts.forEach(ext => {
      const row = document.createElement('div');
      row.className = 'mg-item';
      row.style.flexDirection = 'column';
      row.style.alignItems = 'flex-start';
      row.style.gap = '6px';

      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;width:100%;align-items:center';
      top.innerHTML = '<label style="font-weight:600;font-size:14px">' + ext.name + '</label><span style="font-size:11px;color:var(--fg-dim)">' + ext.version + '</span>';
      row.appendChild(top);

      const idLine = document.createElement('div');
      idLine.style.cssText = 'font-size:10px;color:var(--fg-dim);font-family:monospace';
      idLine.textContent = ext.id;
      row.appendChild(idLine);

      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:6px;margin-top:4px';

      // Toggle button
      const toggleBtn = document.createElement('button');
      toggleBtn.style.cssText = 'padding:3px 8px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;font-size:11px;color:var(--fg-muted);transition:all 0.15s ease;cursor:pointer';
      toggleBtn.textContent = ext.enabled !== false ? 'Disable' : 'Enable';
      toggleBtn.addEventListener('click', async () => {
        if (ext.enabled !== false) {
          await safeInvoke('extensions:disable', ext.id);
          ext.enabled = false;
          toggleBtn.textContent = 'Enable';
          toggleBtn.style.color = 'var(--accent)';
        } else {
          await safeInvoke('extensions:enable', ext.id);
          ext.enabled = true;
          toggleBtn.textContent = 'Disable';
          toggleBtn.style.color = 'var(--fg-muted)';
        }
      });
      btns.appendChild(toggleBtn);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.style.cssText = 'padding:3px 8px;border:1px solid rgba(255,80,80,0.3);border-radius:6px;font-size:11px;color:#ff6b6b;transition:all 0.15s ease;cursor:pointer';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        await safeInvoke('extensions:remove', ext.id);
        renderExtensions(); // refresh list
      });
      btns.appendChild(removeBtn);

      // Reload button
      const reloadBtn = document.createElement('button');
      reloadBtn.style.cssText = 'padding:3px 8px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;font-size:11px;color:var(--fg-muted);transition:all 0.15s ease;cursor:pointer';
      reloadBtn.textContent = 'Reload';
      reloadBtn.addEventListener('click', async () => {
        await safeInvoke('extensions:reload', ext.id);
        toast('Extension reloaded');
      });
      btns.appendChild(reloadBtn);

      row.appendChild(btns);
      panelBody.appendChild(row);
    });
    const storeBtn = document.createElement('button');
    storeBtn.className = 'btn';
    storeBtn.textContent = 'Open Chrome Web Store';
    storeBtn.style.marginTop = '12px';
    storeBtn.addEventListener('click', () => {
      safeInvoke('tabs:create', { url: 'https://chromewebstore.google.com/' });
      closeOverlay();
    });
    panelBody.appendChild(storeBtn);
  }


  function empty(msg) { panelBody.innerHTML = '<div class="empty-state">' + msg + '</div>'; }

  async function renderHistory() {
    const q = panelSearch.value.trim();
    let items;
    try {
      items = q ? await safeInvoke('history:search', q, 50) : await safeInvoke('history:getRecent', 200);
      if (!Array.isArray(items)) items = [];
    } catch { return empty('Error loading history'); }
    panelBody.innerHTML = '';

    if (!items.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'empty-state dl-empty';
      emptyEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" style="margin-bottom:12px;opacity:0.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><div style="color:var(--fg-muted)">' + (q ? 'No results found' : 'No history yet') + '</div><div style="font-size:12px;margin-top:4px;color:var(--fg-dim)">Pages you visit will appear here</div>';
      panelBody.appendChild(emptyEl);
      return;
    }

    // Clear all button
    const hdr = document.createElement('div');
    hdr.className = 'dl-panel-header';
    hdr.innerHTML = '<span class="dl-panel-count">' + items.length + ' item' + (items.length !== 1 ? 's' : '') + '</span>';
    const clrBtn = document.createElement('button');
    clrBtn.className = 'dl-clear-btn';
    clrBtn.textContent = 'Clear all';
    clrBtn.addEventListener('click', async () => {
      if (confirm('Clear all history?')) {
        await safeInvoke('history:clear');
        renderHistory();
        toast('History cleared');
      }
    });
    hdr.appendChild(clrBtn);
    panelBody.appendChild(hdr);

    // Group by time
    const now = Date.now();
    const groups = { 'Today': [], 'Yesterday': [], 'Earlier this week': [], 'Older': [] };
    for (const it of items) {
      const age = now - (it.visitedAt || it.timestamp || 0);
      if (age < 86400000) groups['Today'].push(it);
      else if (age < 172800000) groups['Yesterday'].push(it);
      else if (age < 604800000) groups['Earlier this week'].push(it);
      else groups['Older'].push(it);
    }
    for (const [label, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const sec = document.createElement('div');
      sec.className = 'dl-section-title';
      sec.textContent = label;
      panelBody.appendChild(sec);
      for (const it of list) {
        const d = document.createElement('div'); d.className = 'pi';
        const favUrl = it.url ? 'https://www.google.com/s2/favicons?domain=' + (function() { try { return new URL(it.url).hostname; } catch { return ''; } })() + '&sz=32' : '';
        d.innerHTML = (favUrl ? '<img class="pi-favicon" src="' + favUrl + '" width="16" height="16" onerror="this.style.display=&quot;none&quot;" />' : '') +
          '<div class="pi-title">' + (it.title || it.url) + '</div><div class="pi-url">' + it.url + '</div>';
        d.addEventListener('click', () => { safeInvoke('tabs:navigate', null, it.url); closeOverlay(); });
        panelBody.appendChild(d);
      }
    }
  }

  async function renderBookmarks() {
    let items;
    try { items = await safeInvoke('bookmarks:getAll'); if (!Array.isArray(items)) items = []; } catch { return empty('Error loading bookmarks'); }
    panelBody.innerHTML = '';

    if (!items.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'empty-state dl-empty';
      emptyEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" style="margin-bottom:12px;opacity:0.3"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><div style="color:var(--fg-muted)">No bookmarks yet</div><div style="font-size:12px;margin-top:4px;color:var(--fg-dim)">Bookmark pages using the star in the URL bar</div>';
      panelBody.appendChild(emptyEl);
      return;
    }

    const hdr = document.createElement('div');
    hdr.className = 'dl-panel-header';
    hdr.innerHTML = '<span class="dl-panel-count">' + items.length + ' bookmark' + (items.length !== 1 ? 's' : '') + '</span>';
    panelBody.appendChild(hdr);

    for (const bm of items) {
      const d = document.createElement('div'); d.className = 'pi';
      const favUrl = bm.url ? 'https://www.google.com/s2/favicons?domain=' + (function() { try { return new URL(bm.url).hostname; } catch { return ''; } })() + '&sz=32' : '';
      d.innerHTML = (favUrl ? '<img class="pi-favicon" src="' + favUrl + '" width="16" height="16" onerror="this.style.display=&quot;none&quot;" />' : '') +
        '<div class="pi-title">' + (bm.title || bm.url) + '</div><div class="pi-url">' + bm.url + '</div><span class="pi-del">✕</span>';
      d.addEventListener('click', () => { safeInvoke('tabs:navigate', null, bm.url); closeOverlay(); });
      d.querySelector('.pi-del').addEventListener('click', async e => { e.stopPropagation(); await safeInvoke('bookmarks:remove', bm.id); renderBookmarks(); });
      panelBody.appendChild(d);
    }
  }

  let _dlPollTimer = null;

  function getDlFileType(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext)) return 'image';
    if (['mp4','mkv','avi','mov','webm','flv'].includes(ext)) return 'video';
    if (['mp3','wav','ogg','flac','aac','m4a'].includes(ext)) return 'audio';
    if (['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','rtf','odt'].includes(ext)) return 'document';
    if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return 'archive';
    if (['exe','msi','dmg','app','deb','rpm','apk','bat','cmd'].includes(ext)) return 'executable';
    if (['js','ts','py','java','c','cpp','h','css','html','json','xml'].includes(ext)) return 'code';
    return 'generic';
  }

  function getDlIcon(type) {
    const icons = {
      image: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
      video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
      audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
      archive: '<path d="M21 8v13H3V3h12l6 5z"/><path d="M10 12h4"/><path d="M10 16h4"/><path d="M10 8h4"/>',
      executable: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
      code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
      generic: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">' + (icons[type] || icons.generic) + '</svg>';
  }

  function getDlColor(type) {
    const colors = {
      image: '#5a83ff', video: '#a855f7', audio: '#ec4899',
      document: '#3b82f6', archive: '#f59e0b', executable: '#ef4444',
      code: '#10b981', generic: '#6b7280',
    };
    return colors[type] || colors.generic;
  }

  function fmtSpeed(bytesPerSec) {
    if (!bytesPerSec || isNaN(bytesPerSec)) return '';
    if (bytesPerSec > 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
    if (bytesPerSec > 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
    return bytesPerSec + ' B/s';
  }

  function fmtTimeRemaining(bytesRemaining, bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0 || !bytesRemaining) return '';
    const secs = Math.ceil(bytesRemaining / bytesPerSec);
    if (secs < 60) return secs + 's left';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's left';
    return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm left';
  }

  async function renderDownloads() {
    let items;
    try { items = await safeInvoke('downloads:getAll'); if (!Array.isArray(items)) items = []; } catch { return empty('Error loading downloads'); }

    panelBody.innerHTML = '';

    // ── Header bar with count + clear all ──
    const hdr = document.createElement('div');
    hdr.className = 'dl-panel-header';
    const activeCount = items.filter(i => i.state === 'progressing').length;
    const doneCount = items.filter(i => i.state === 'complete').length;
    hdr.innerHTML = '<span class="dl-panel-count">' +
      (items.length ? items.length + ' download' + (items.length !== 1 ? 's' : '') : '') +
      (activeCount ? ' · ' + activeCount + ' active' : '') +
      (doneCount ? ' · ' + doneCount + ' done' : '') +
      '</span>';
    if (items.length) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'dl-clear-btn';
      clearBtn.textContent = 'Clear all';
      clearBtn.addEventListener('click', async () => {
        await safeInvoke('downloads:clear');
        renderDownloads();
        toast('Downloads cleared');
      });
      hdr.appendChild(clearBtn);
    }
    panelBody.appendChild(hdr);

    if (!items.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'empty-state dl-empty';
      emptyEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" style="margin-bottom:12px;opacity:0.3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><div style="color:var(--fg-muted)">No downloads yet</div><div style="font-size:12px;margin-top:4px;color:var(--fg-dim)">Files you download will appear here</div>';
      panelBody.appendChild(emptyEl);
      return;
    }

    // ── Separate active from completed/failed ──
    const active = items.filter(i => i.state === 'progressing');
    const done = items.filter(i => i.state === 'complete' || i.state === 'failed' || i.state === 'cancelled');

    if (active.length) {
      const sec = document.createElement('div');
      sec.className = 'dl-section-title';
      sec.textContent = 'Downloading';
      panelBody.appendChild(sec);
      for (const dl of active) panelBody.appendChild(createDlItem(dl, true));
    }

    if (done.length) {
      const sec = document.createElement('div');
      sec.className = 'dl-section-title';
      sec.textContent = 'Completed';
      panelBody.appendChild(sec);
      for (const dl of done) panelBody.appendChild(createDlItem(dl, false));
    }

    // ── Live polling for active downloads ──
    startDlPoll();
  }

  function createDlItem(dl, isActive) {
    const type = getDlFileType(dl.filename);
    const color = getDlColor(type);
    const icon = getDlIcon(type);
    const pct = dl.totalBytes > 0 ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : 0;
    const elapsed = (Date.now() - (dl.startedAt || Date.now())) / 1000;
    const speed = elapsed > 1 && dl.receivedBytes > 0 ? (dl.receivedBytes / elapsed) : 0;
    const remaining = speed > 0 ? (dl.totalBytes - dl.receivedBytes) : 0;

    let statusText = '';
    if (dl.state === 'progressing') {
      statusText = fmtBytes(dl.receivedBytes) + ' / ' + fmtBytes(dl.totalBytes);
      if (speed > 100) statusText += ' · ' + fmtSpeed(speed);
      const eta = fmtTimeRemaining(remaining, speed);
      if (eta) statusText += ' · ' + eta;
    } else if (dl.state === 'complete') {
      statusText = fmtBytes(dl.totalBytes) + ' · Complete';
    } else if (dl.state === 'failed') {
      statusText = 'Download failed';
    } else if (dl.state === 'cancelled') {
      statusText = 'Cancelled';
    }

    const d = document.createElement('div');
    d.className = 'dl-item dl-item-' + dl.state;
    d.setAttribute('data-dl-id', dl.id);

    d.innerHTML =
      '<div class="dl-item-icon" style="color:' + color + ';background:' + color + '15">' + icon + '</div>' +
      '<div class="dl-item-body">' +
        '<div class="dl-item-name" title="' + escapeHtml(dl.filename) + '">' + escapeHtml(dl.filename) + '</div>' +
        '<div class="dl-item-status">' + statusText + '</div>' +
        (isActive ?
          '<div class="dl-item-progress">' +
            '<div class="dl-item-progress-track">' +
              '<div class="dl-item-progress-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
            '</div>' +
          '</div>' : '') +
      '</div>' +
      '<div class="dl-item-actions">' +
        (dl.state === 'complete' && dl.savePath ?
          '<button class="dl-btn dl-btn-open" title="Open file">Open</button>' +
          '<button class="dl-btn dl-btn-folder" title="Show in folder">Folder</button>'
          : '') +
        '<button class="dl-btn dl-btn-remove" title="Remove">✕</button>' +
      '</div>';

    // Wire actions
    const openBtn = d.querySelector('.dl-btn-open');
    if (openBtn) openBtn.addEventListener('click', (e) => { e.stopPropagation(); safeInvoke('downloads:openFile', dl.savePath); });

    const folderBtn = d.querySelector('.dl-btn-folder');
    if (folderBtn) folderBtn.addEventListener('click', (e) => { e.stopPropagation(); safeInvoke('downloads:openFolder', dl.savePath); });

    const removeBtn = d.querySelector('.dl-btn-remove');
    if (removeBtn) removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await safeInvoke('downloads:remove', dl.id);
      renderDownloads();
    });

    return d;
  }

  function startDlPoll() {
    clearInterval(_dlPollTimer);
    _dlPollTimer = null;
    // Only poll if panel is open on downloads
    if (currentPanel !== 'downloads') return;
    _dlPollTimer = setInterval(async () => {
      if (currentPanel !== 'downloads') { clearInterval(_dlPollTimer); _dlPollTimer = null; return; }
      try {
        const items = await safeInvoke('downloads:getAll');
        if (!Array.isArray(items)) return;
        const hasActive = items.some(i => i.state === 'progressing');
        // Update progress bars in-place for active items
        for (const dl of items) {
          if (dl.state !== 'progressing') continue;
          const el = panelBody.querySelector('[data-dl-id="' + dl.id + '"]');
          if (!el) continue;
          const pct = dl.totalBytes > 0 ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : 0;
          const elapsed = (Date.now() - (dl.startedAt || Date.now())) / 1000;
          const speed = elapsed > 1 && dl.receivedBytes > 0 ? (dl.receivedBytes / elapsed) : 0;
          const fill = el.querySelector('.dl-item-progress-fill');
          const status = el.querySelector('.dl-item-status');
          if (fill) fill.style.width = pct + '%';
          if (status) {
            let s = fmtBytes(dl.receivedBytes) + ' / ' + fmtBytes(dl.totalBytes);
            if (speed > 100) s += ' · ' + fmtSpeed(speed);
            const eta = fmtTimeRemaining(dl.totalBytes - dl.receivedBytes, speed);
            if (eta) s += ' · ' + eta;
            status.textContent = s;
          }
        }
        // Check if any item completed — full re-render
        const hasNewComplete = items.some(i => i.state === 'complete' && !panelBody.querySelector('[data-dl-id="' + i.id + '"].dl-item-complete'));
        if (hasNewComplete || (!hasActive && items.length > 0)) renderDownloads();
      } catch {}
    }, 500);
  }

  function stopDlPoll() {
    if (_dlPollTimer) { clearInterval(_dlPollTimer); _dlPollTimer = null; }
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

  function goToMenu() {
    stopDlPoll();
    panel.classList.remove('open');
    currentPanel = '';
    panelBody.innerHTML = '';
    panelTitle.textContent = '';
    sideMenu.classList.add('open');
  }

  /* ── Event wiring ────────────────────────────────────────── */
  backdrop.addEventListener('click', closeOverlay);
  $('menu-close-btn').addEventListener('click', closeOverlay);
  $('panel-back').addEventListener('click', goToMenu);
  panelSearch.addEventListener('input', loadPanel);
  $('sm-history').addEventListener('click', () => openPanel('history', 'History'));
  $('sm-bookmarks').addEventListener('click', () => openPanel('bookmarks', 'Bookmarks'));
  $('sm-downloads').addEventListener('click', () => openPanel('downloads', 'Downloads'));
  $('sm-settings').addEventListener('click', () => openPanel('settings', 'Settings'));

  /* ── IPC events from main process ────────────────────────── */
  api.on('menu:changed', () => loadPanel());
  api.on('downloads:changed', () => { if (currentPanel === 'downloads') renderDownloads(); });

  // When the main process opens/closes the menu overlay view (sliding it in/out),
  // toggle the DOM classes on side-menu, backdrop, and panel so CSS transitions work.
  api.on('menu:state', (isOpen) => {
    if (isOpen) {
      backdrop.classList.add('open');
      sideMenu.classList.add('open');
      refreshAdblockState();
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
