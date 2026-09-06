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

  async function safeInvoke(ch, ...a) {
    try { return await api.invoke(ch, ...a); } catch { return undefined; }
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  const MENU_ITEMS = [
    { label: 'New Tab', action: 'createTab' },
    { label: 'Extensions', action: 'panel', panel: 'extensions', title: 'Extensions' },
    { label: 'Bookmarks', action: 'panel', panel: 'bookmarks', title: 'Bookmarks' },
    { label: 'History', action: 'panel', panel: 'history', title: 'History' },
    { label: 'Downloads', action: 'panel', panel: 'downloads', title: 'Downloads' },
    { label: 'Refresh', action: 'refresh' },
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
    if (item.action === 'createTab') { safeInvoke('tabs:create', {}); closeOverlay(); }
    else if (item.action === 'refresh') { safeInvoke('tabs:reload'); closeOverlay(); }
    else if (item.action === 'panel') openPanel(item.panel, item.title);
  }

  function closeOverlay() {
    backdrop.classList.remove('open');
    sideMenu.classList.remove('open');
    panel.classList.remove('open');
    currentPanel = '';
    panelBody.innerHTML = '';
    panelTitle.textContent = '';
    safeInvoke('ui:closeMenu');
  }

  function openPanel(type, title) {
    panelTitle.textContent = title;
    panelAction.innerHTML = '';
    panelSearch.classList.add('hidden');
    panelSearch.value = '';
    if (type === 'history') panelSearch.classList.remove('hidden');
    sideMenu.classList.remove('open');
    panel.classList.add('open');
    currentPanel = type;
    panelBody.innerHTML = '<div class="empty-state">Loading...</div>';
    loadPanel();
  }

  async function loadPanel() {
    panelBody.innerHTML = '';
    if (currentPanel === 'extensions') return renderExtensions();
    if (currentPanel === 'history') return renderHistory();
    if (currentPanel === 'bookmarks') return renderBookmarks();
    if (currentPanel === 'downloads') return renderDownloads();
    if (currentPanel === 'settings') return renderSettings();
    if (currentPanel === 'siteSettings') return renderSiteSettings();
    panelBody.innerHTML = '<div class="empty-state">—</div>';
  }

  // ── Extensions panel ──
  async function renderExtensions() {
    const exts = await safeInvoke('extensions:list');
    if (!exts || !exts.length) {
      panelBody.innerHTML = '<div class="empty-state">No extensions installed.<br><small style="color:var(--fg-dim)">Use Developer Mode → Load Unpacked to install.</small></div>';
      // Add Developer Mode toggle
      const devRow = document.createElement('div');
      devRow.className = 'mg-item';
      devRow.innerHTML = '<label>Developer Mode</label>';
      const sw = document.createElement('div');
      sw.className = 'switch';
      sw.addEventListener('click', async () => {
        sw.classList.toggle('on');
        if (sw.classList.contains('on')) {
          // Show "Load Unpacked" button
          let loadBtn = panelBody.querySelector('.load-unpacked-btn');
          if (!loadBtn) {
            loadBtn = document.createElement('button');
            loadBtn.className = 'btn load-unpacked-btn';
            loadBtn.textContent = 'Load Unpacked';
            loadBtn.addEventListener('click', async () => {
              const result = await safeInvoke('extensions:openDirPicker');
              if (result && result.success) toast('Extension installed');
              else if (result && result.error) toast('Error: ' + result.error);
              renderExtensions();
            });
            panelBody.appendChild(loadBtn);
          }
        }
      });
      devRow.appendChild(sw);
      panelBody.appendChild(devRow);
      return;
    }

    // Extension list
    for (const ext of exts) {
      const card = document.createElement('div');
      card.className = 'pi';
      const desc = ext.description ? '<div class="pi-url">' + ext.description + '</div>' : '';
      card.innerHTML = '<div class="pi-title">' + ext.name + ' <small style="color:var(--fg-dim)">' + ext.version + '</small></div>' + desc;
      card.style.cursor = 'pointer';

      // Toggle switch
      const sw = document.createElement('div');
      sw.className = 'switch' + (ext.enabled ? ' on' : '');
      sw.style.position = 'absolute';
      sw.style.right = '14px';
      sw.style.top = '12px';
      sw.addEventListener('click', async (e) => {
        e.stopPropagation();
        sw.classList.toggle('on');
        if (sw.classList.contains('on')) await safeInvoke('extensions:enable', ext.id);
        else await safeInvoke('extensions:disable', ext.id);
      });
      card.appendChild(sw);

      // Click to open popup if extension has one
      card.addEventListener('click', async () => {
        const info = await safeInvoke('extensions:getInfo', ext.id);
        if (info && info.manifest && info.manifest.action && info.manifest.action.default_popup) {
          await safeInvoke('extensions:openPopup', ext.id);
          closeOverlay();
        }
      });

      panelBody.appendChild(card);
    }

    // Developer Mode + Load Unpacked
    const devRow = document.createElement('div');
    devRow.className = 'mg-item';
    devRow.style.borderTop = '1px solid rgba(255,255,255,0.06)';
    devRow.innerHTML = '<label>Developer Mode</label>';
    const devSw = document.createElement('div');
    devSw.className = 'switch';
    devSw.addEventListener('click', async () => {
      devSw.classList.toggle('on');
      let loadBtn = panelBody.querySelector('.load-unpacked-btn');
      if (devSw.classList.contains('on') && !loadBtn) {
        loadBtn = document.createElement('button');
        loadBtn.className = 'btn load-unpacked-btn';
        loadBtn.style.margin = '12px 18px';
        loadBtn.textContent = 'Load Unpacked';
        loadBtn.addEventListener('click', async () => {
          const result = await safeInvoke('extensions:openDirPicker');
          if (result && result.success) { toast('Extension installed'); renderExtensions(); }
          else if (result && result.error) toast('Error: ' + result.error);
        });
        panelBody.appendChild(loadBtn);
      } else if (!devSw.classList.contains('on') && loadBtn) {
        loadBtn.remove();
      }
    });
    devRow.appendChild(devSw);
    panelBody.appendChild(devRow);
  }

  async function renderHistory() {
    const items = await safeInvoke('history:getRecent', 100);
    if (!items || !items.length) { panelBody.innerHTML = '<div class="empty-state">No history</div>'; return; }
    const q = panelSearch.value.toLowerCase();
    const filtered = q ? items.filter(i => (i.title || '').toLowerCase().includes(q) || (i.url || '').toLowerCase().includes(q)) : items;
    for (const item of filtered) {
      const el = document.createElement('div');
      el.className = 'pi';
      el.innerHTML = '<div class="pi-title">' + (item.title || item.url || '—') + '</div><div class="pi-url">' + item.url + '</div>';
      el.addEventListener('click', () => { safeInvoke('tabs:create', { url: item.url }); closeOverlay(); });
      panelBody.appendChild(el);
    }
  }

  async function renderBookmarks() {
    const items = await safeInvoke('bookmarks:getAll');
    if (!items || !items.length) { panelBody.innerHTML = '<div class="empty-state">No bookmarks</div>'; return; }
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'pi';
      el.innerHTML = '<div class="pi-title">' + (item.title || '—') + '</div><div class="pi-url">' + item.url + '</div><button class="pi-del">✕</button>';
      el.querySelector('.pi-del').addEventListener('click', async (e) => { e.stopPropagation(); await safeInvoke('bookmarks:remove', item.id); loadPanel(); });
      el.addEventListener('click', () => { safeInvoke('tabs:create', { url: item.url }); closeOverlay(); });
      panelBody.appendChild(el);
    }
  }

  async function renderDownloads() {
    const items = await safeInvoke('downloads:getAll');
    if (!items || !items.length) { panelBody.innerHTML = '<div class="empty-state">No downloads</div>'; return; }
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'dl-item';
      el.innerHTML = '<div class="dl-name">' + (item.filename || item.url || '—') + '</div><div class="dl-meta">' + (item.state || '') + '</div><div class="dl-actions"><button class="dl-open">Open</button><button class="dl-folder">Folder</button><button class="dl-remove">✕</button></div>';
      el.querySelector('.dl-open').addEventListener('click', () => safeInvoke('downloads:openFile', item.path));
      el.querySelector('.dl-folder').addEventListener('click', () => safeInvoke('downloads:openFolder', item.path));
      el.querySelector('.dl-remove').addEventListener('click', () => { safeInvoke('downloads:remove', item.id); loadPanel(); });
      panelBody.appendChild(el);
    }
  }

  async function renderSettings() {
    const cfg = await safeInvoke('settings:get');
    if (!cfg) { panelBody.innerHTML = '<div class="empty-state">—</div>'; return; }
    const item = (lbl, ctrl) => { const el = document.createElement('div'); el.className = 'mg-item'; el.innerHTML = '<label>' + lbl + '</label>'; el.appendChild(ctrl); return el; };
    const sec = (txt) => { const el = document.createElement('div'); el.className = 'sec-title'; el.textContent = txt; return el; };
    panelBody.appendChild(sec('General'));
    const sel = document.createElement('select'); sel.className = 'setting-sel';
    [{ k: 'en', v: 'English' }, { k: 'fr', v: 'Français' }, { k: 'de', v: 'Deutsch' }].forEach(({ k, v }) => { const o = document.createElement('option'); o.value = k; o.textContent = v; if (k === cfg.language) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', async () => { await safeInvoke('settings:set', 'language', sel.value); toast('Language: ' + sel.value); });
    panelBody.appendChild(item('Language', sel));

    panelBody.appendChild(sec('Search Engine'));
    const engSel = document.createElement('select'); engSel.className = 'setting-sel';
    [{ k: 'google', v: 'Google' }, { k: 'duckduckgo', v: 'DuckDuckGo' }, { k: 'bing', v: 'Bing' }].forEach(({ k, v }) => { const o = document.createElement('option'); o.value = k; o.textContent = v; if (k === cfg.searchEngine) o.selected = true; engSel.appendChild(o); });
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
    if (!activeUrl) { panelBody.innerHTML = '<div class="empty-state">No site loaded</div>'; return; }
    let host;
    try { host = new URL(activeUrl).hostname; } catch { panelBody.innerHTML = '<div class="empty-state">—</div>'; return; }
    let rule;
    try { rule = await safeInvoke('site:getRule', host); } catch { rule = {}; }
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

  /* ── Event wiring ── */
  backdrop.addEventListener('click', closeOverlay);
  $('menu-close-btn').addEventListener('click', closeOverlay);
  $('panel-back').addEventListener('click', closeOverlay);
  panelSearch.addEventListener('input', loadPanel);
  $('sm-history').addEventListener('click', () => openPanel('history', 'History'));
  $('sm-bookmarks').addEventListener('click', () => openPanel('bookmarks', 'Bookmarks'));
  $('sm-downloads').addEventListener('click', () => openPanel('downloads', 'Downloads'));
  $('sm-settings').addEventListener('click', () => openPanel('settings', 'Settings'));

  /* ── IPC events ── */
  api.on('menu:changed', () => loadPanel());

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

  // Handle navigation from pill (e.g. extensions button)
  api.on('menu:navigate', (panelType) => {
    if (panelType) {
      const titles = { extensions: 'Extensions', history: 'History', bookmarks: 'Bookmarks', downloads: 'Downloads', settings: 'Settings', siteSettings: 'Site Settings' };
      openPanel(panelType, titles[panelType] || panelType);
    }
  });

  buildMenu();
})();
