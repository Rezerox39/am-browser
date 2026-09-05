'use strict';

(() => {
  const api = window.am;
  if (!api) {
    document.body.innerHTML = '<h1 style="color:#fff;padding:40px">Preload unavailable</h1>';
    return;
  }

  /* ── Tiny i18n client ───────────────────────────────────── */
  const i18n = {
    strings: {},
    fallback: {},
    async init() {
      try {
        const settings = await api.invoke('settings:get');
        await this.loadFor(settings.language || 'en');
        if (settings.language !== 'en') {
          try { this.fallback = await (await fetch('i18n/locales/en.json')).json(); } catch {}
        }
      } catch (e) { console.error('i18n init', e); }
    },
    async loadFor(locale) {
      try { this.strings = await (await fetch('i18n/locales/' + locale + '.json')).json(); } catch { this.strings = this.fallback; }
      if (locale !== 'en' && Object.keys(this.fallback).length === 0) {
        try { this.fallback = await (await fetch('i18n/locales/en.json')).json(); } catch {}
      }
    },
    t(key, vars) {
      let val = this.strings[key] || this.fallback[key] || key;
      if (vars && typeof val === 'string') {
        for (const [k, v] of Object.entries(vars)) val = val.split('{{' + k + '}}').join(String(v));
      }
      return val;
    },
  };

  /* ── DOM refs ───────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const urlInput = $('urlInput');
  const omniboxLock = $('omniboxLock');
  const tabList = $('tabList');
  const panels = { history: $('panelHistory'), bookmarks: $('panelBookmarks'), downloads: $('panelDownloads'), settings: $('panelSettings'), siteSettings: $('panelSiteSettings') };
  let allTabs = [], activeId = null, activeUrl = '', activeTitle = '', currentPanel = null;

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => { const k = el.getAttribute('data-i18n'); if (k) el.textContent = i18n.t(k); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { const k = el.getAttribute('data-i18n-placeholder'); if (k) el.placeholder = i18n.t(k); });
  }

  function faviconFor(url) { try { return new URL(url).hostname[0]?.toUpperCase() || '·'; } catch { return '·'; } }
  function fmtBytes(b) { if (!b || isNaN(b)) return '0 B'; const u = ['B','KB','MB','GB']; let i = 0, n = b; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }

  /* ── Tab list rendering ─────────────────────────────────── */
  function renderTabs() {
    tabList.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'pill-tab' + (tab.id === activeId ? ' active' : '');
      el.addEventListener('click', () => api.invoke('tabs:setActive', tab.id));
      el.innerHTML = '<span class="tab-glow"></span><span class="tab-icon">' + (tab.loading ? '⟳' : faviconFor(tab.url)) + '</span><span class="tab-title">' + (tab.title || 'New Tab') + '</span>';
      const close = document.createElement('button');
      close.className = 'tab-close-btn';
      close.textContent = '✕';
      close.addEventListener('click', (e) => { e.stopPropagation(); api.send('tabs:close', tab.id); });
      el.appendChild(close);
      tabList.appendChild(el);
    }
  }

  function syncAddressBar() {
    if (document.activeElement === urlInput) return;
    urlInput.value = activeUrl || '';
    const secure = activeUrl.startsWith('https://') || activeUrl.startsWith('am://');
    omniboxLock.className = secure ? '' : 'idle';
    omniboxLock.textContent = secure ? '🔒' : '🌐';
    $('omniboxAction').classList.toggle('muted', !activeUrl);
  }

  /* ── Panels ─────────────────────────────────────────────── */
  function closePanels() { Object.values(panels).forEach((p) => { p.style.display = 'none'; }); currentPanel = null; }
  function openPanel(panel) { closePanels(); panel.style.display = 'flex'; currentPanel = panel; refreshPanel(panel); }
  async function refreshPanel(panel) {
    if (panel === panels.history) await renderHistory();
    else if (panel === panels.bookmarks) await renderBookmarks();
    else if (panel === panels.downloads) await renderDownloads();
    else if (panel === panels.settings) await renderSettings();
    else if (panel === panels.siteSettings) await renderSiteSettings();
  }
  function empty(el, key) { el.innerHTML = '<div class="empty-state">' + i18n.t(key) + '</div>'; }

  async function renderHistory() {
    const list = $('historyList');
    const q = $('historySearch').value.trim();
    let items; try { items = q ? await api.invoke('history:search', q, 50) : await api.invoke('history:getRecent', 100); } catch { return empty(list, 'error.title'); }
    if (!items.length) return empty(list, 'history.empty');
    list.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'panel-item';
      row.addEventListener('click', () => { navigate(item.url); closePanels(); });
      row.innerHTML = '<span class="item-favicon">' + faviconFor(item.url) + '</span><div class="item-main"><div class="item-title">' + (item.title || item.url) + '</div><div class="item-url">' + item.url + '</div></div>';
      list.appendChild(row);
    }
  }

  async function renderBookmarks() {
    const list = $('bookmarksList');
    let items; try { items = await api.invoke('bookmarks:getAll'); } catch { return empty(list, 'error.title'); }
    if (!items.length) return empty(list, 'bookmarks.empty');
    list.innerHTML = '';
    for (const bm of items) {
      const row = document.createElement('div');
      row.className = 'panel-item';
      row.addEventListener('click', () => { navigate(bm.url); closePanels(); });
      row.innerHTML = '<span class="item-favicon">' + faviconFor(bm.url) + '</span><div class="item-main"><div class="item-title">' + (bm.title || bm.url) + '</div><div class="item-url">' + bm.url + '</div></div>';
      const del = document.createElement('button');
      del.className = 'item-action';
      del.textContent = '✕';
      del.addEventListener('click', async (e) => { e.stopPropagation(); await api.invoke('bookmarks:remove', bm.id); renderBookmarks(); });
      row.appendChild(del);
      list.appendChild(row);
    }
  }

  async function renderDownloads() {
    const list = $('downloadsList');
    let items; try { items = await api.invoke('downloads:getAll'); } catch { return empty(list, 'error.title'); }
    if (!items.length) return empty(list, 'downloads.empty');
    list.innerHTML = '';
    for (const dl of items) {
      const row = document.createElement('div');
      row.className = 'panel-item';
      const stateStr = dl.state === 'progressing' ? i18n.t('downloads.downloading') : dl.state === 'failed' ? i18n.t('downloads.failed') : dl.state === 'cancelled' ? i18n.t('downloads.cancelled') : i18n.t('downloads.complete');
      row.innerHTML = '<div class="item-main"><div class="item-title">' + dl.filename + '</div><div class="item-url">' + stateStr + ' · ' + fmtBytes(dl.receivedBytes || dl.totalBytes) + '</div></div>';
      const act = document.createElement('button');
      act.className = 'item-action';
      act.textContent = dl.state === 'complete' ? '↯' : '✕';
      act.addEventListener('click', async () => {
        if (dl.state === 'complete' && dl.savePath) await api.invoke('downloads:openFile', dl.savePath);
        else { await api.invoke('downloads:remove', dl.id); renderDownloads(); }
      });
      row.appendChild(act);
      list.appendChild(row);
    }
  }

  async function renderSettings() {
    const cfg = await api.invoke('settings:get');
    const available = await api.invoke('i18n:getAvailable');
    const sp = $('settingsPanel');
    sp.innerHTML = '';

    sp.appendChild(makeSectionTitle(i18n.t('settings.general')));
    sp.appendChild(makeSettingRow(i18n.t('settings.language'), makeSelect(available.map(l => ({value:l,label:l.toUpperCase()})), cfg.language, async (v) => { await api.invoke('settings:set', 'language', v); await i18n.loadFor(v); applyI18n(); renderSettings(); })));
    sp.appendChild(makeSettingRow(i18n.t('settings.searchEngine'), makeSelect([{value:'google',label:'Google'},{value:'bing',label:'Bing'},{value:'duckduckgo',label:'DuckDuckGo'}], cfg.searchEngine, (v) => api.invoke('settings:set', 'searchEngine', v))));
    sp.appendChild(makeSettingRow(i18n.t('settings.homePage'), makeTextInput(cfg.homePage, (v) => api.invoke('settings:set', 'homePage', v))));

    sp.appendChild(makeSectionTitle(i18n.t('settings.adblocking')));
    sp.appendChild(makeSettingRow(i18n.t('settings.adblockEnabled'), makeToggle('adblock-on', cfg.adblock.enabled, (v) => { cfg.adblock.enabled = v; api.invoke('settings:set', 'adblock', cfg.adblock); })));
    const stats = await api.invoke('adblock:getStats').catch(() => null);
    if (stats) sp.appendChild(makeSettingRow(i18n.t('settings.adblockStats'), '<span class="setting-hint">' + stats.blocked + '</span>'));

    sp.appendChild(makeSectionTitle(i18n.t('settings.downloads')));
    sp.appendChild(makeSettingRow(i18n.t('settings.askWhereToSave'), makeToggle('ask-save', cfg.askWhereToSave, (v) => api.invoke('settings:set', 'askWhereToSave', v))));
    sp.appendChild(makeSettingRow(i18n.t('settings.blockPopups'), makeToggle('block-popups', cfg.blockPopups, (v) => api.invoke('settings:set', 'blockPopups', v))));

    sp.appendChild(makeSectionTitle(i18n.t('settings.clearData')));
    const clearBtn = document.createElement('button');
    clearBtn.className = 'panel-action-btn';
    clearBtn.textContent = i18n.t('settings.clearHistory');
    clearBtn.style.width = 'auto';
    clearBtn.addEventListener('click', async () => { if (confirm(i18n.t('dialog.clearHistory'))) { await api.invoke('history:clear'); toast(i18n.t('history.title') + ' ✓'); } });
    sp.appendChild(makeSettingRow(i18n.t('settings.clearData'), clearBtn));
  }

  async function renderSiteSettings() {
    if (!activeUrl) { $('siteSettingsPanel').innerHTML = '<div class="empty-state">—</div>'; return; }
    let host; try { host = new URL(activeUrl).hostname; } catch { $('siteSettingsPanel').innerHTML = '<div class="empty-state">—</div>'; return; }
    let rule; try { rule = await api.invoke('site:getRule', host); } catch { rule = {}; }
    rule = rule || {};
    const sp = $('siteSettingsPanel');
    sp.innerHTML = '';
    const hostEl = document.createElement('div');
    hostEl.className = 'site-host';
    hostEl.textContent = host;
    sp.appendChild(hostEl);

    const save = (h, r) => { api.invoke('site:setRule', h, r); toast(i18n.t('settings.confirm') + ' ✓'); };
    for (const [key, ruleKey] of [['site.adblock','adblockEnabled'],['site.javascript','javascript'],['site.popups','popups']]) {
      const current = rule[ruleKey] !== undefined ? rule[ruleKey] : null;
      sp.appendChild(makeSettingRow(i18n.t(key), makeToggle(ruleKey, current === null ? false : !!current, (v) => { rule[ruleKey] = v; save(host, rule); }, current === null)));
    }

    sp.appendChild(makeSectionTitle(i18n.t('site.userAgent')));
    const uaRow = document.createElement('div');
    uaRow.className = 'setting-row';
    uaRow.style.flexDirection = 'column';
    uaRow.style.alignItems = 'stretch';
    const uaInput = document.createElement('textarea');
    uaInput.className = 'ua-input';
    uaInput.value = rule.userAgent || '';
    uaInput.placeholder = i18n.t('site.default');
    uaInput.addEventListener('change', () => { const v = uaInput.value.trim(); if (v) rule.userAgent = v; else delete rule.userAgent; save(host, rule); });
    uaRow.appendChild(uaInput);
    sp.appendChild(uaRow);

    sp.appendChild(makeSectionTitle(i18n.t('site.permissions')));
    const perms = rule.permissions || {};
    for (const perm of ['geolocation','notifications','media']) {
      sp.appendChild(makeSettingRow(i18n.t('site.' + perm), makeToggle('perm-' + perm, perms[perm] || false, (v) => { rule.permissions = rule.permissions || {}; rule.permissions[perm] = v; save(host, rule); })));
    }
  }

  function makeSectionTitle(text) { const el = document.createElement('div'); el.className = 'settings-section-title'; el.textContent = text; return el; }
  function makeSettingRow(label, control) {
    const wrap = document.createElement('div');
    wrap.className = 'setting-row';
    const lbl = document.createElement('div'); lbl.className = 'setting-label'; lbl.textContent = label;
    const ctrl = document.createElement('div'); ctrl.className = 'setting-control';
    if (typeof control === 'string') ctrl.innerHTML = control; else ctrl.appendChild(control);
    wrap.appendChild(lbl); wrap.appendChild(ctrl); return wrap;
  }
  function makeSelect(opts, value, onChange) {
    const sel = document.createElement('select');
    for (const o of opts) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; if (o.value === value) op.selected = true; sel.appendChild(op); }
    sel.addEventListener('change', () => onChange(sel.value)); return sel;
  }
  function makeTextInput(value, onChange) {
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = value || '';
    inp.addEventListener('change', () => onChange(inp.value.trim())); return inp;
  }
  function makeToggle(id, checked, onChange, isDefault) {
    const label = document.createElement('label'); label.className = 'toggle';
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    const track = document.createElement('span'); track.className = 'track';
    label.appendChild(input); label.appendChild(track);
    if (isDefault) { const hint = document.createElement('span'); hint.className = 'setting-hint'; hint.textContent = i18n.t('site.default'); const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:8px'; wrap.appendChild(label); wrap.appendChild(hint); return wrap; }
    return label;
  }

  /* ── Navigation helpers ─────────────────────────────────── */
  async function navigate(url) { const id = await api.invoke('tabs:getActiveId'); await api.invoke('tabs:navigate', id, url); }
  function searchUrl(q) { const eq = encodeURIComponent(q.trim()); return 'https://www.google.com/search?q=' + eq; }
  function normalize(input) {
    const s = input.trim(); if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (/^localhost(\/|$)/i.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s) && /\./.test(s)) return 'https://' + s;
    return searchUrl(s);
  }

  urlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { const url = normalize(urlInput.value); if (url) { urlInput.blur(); await navigate(url); } }
  });

  /* ── FLOATING PILL — Spring Physics ─────────────────────── */
  const pill = $('floatingPill');
  const pillBody = $('pillBody');
  const pillBubble = $('pillBubble');
  let pillCollapsed = false;
  let pillDragging = false;
  let pillDragStartX = 0, pillDragStartY = 0;
  let pillSpringX, pillSpringY;
  let pillLastTime = 0;
  let pillAnchorX = 0, pillAnchorY = 0;
  let pillHasMoved = false;

  function pillInit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    pillAnchorX = vw / 2;
    pillAnchorY = vh - 60;
    pillSpringX = new Spring({ stiffness: 200, damping: 14, mass: 1 });
    pillSpringY = new Spring({ stiffness: 200, damping: 14, mass: 1 });
    pillSpringX.setPosition(pillAnchorX);
    pillSpringX.setTarget(pillAnchorX);
    pillSpringY.setPosition(pillAnchorY);
    pillSpringY.setTarget(pillAnchorY);
    requestAnimationFrame(pillTick);
  }

  function pillTick(now) {
    if (!pillLastTime) pillLastTime = now;
    const dt = Math.min((now - pillLastTime) / 1000, 0.064);
    pillLastTime = now;

    pillSpringX.step(dt);
    pillSpringY.step(dt);

    const x = pillSpringX.position;
    const y = pillSpringY.position;
    pill.style.left = x + 'px';
    pill.style.top = y + 'px';
    pill.style.transform = 'translate(-50%, -50%)';

    requestAnimationFrame(pillTick);
  }

  function pillSnapToAnchor() {
    pillAnchorX = window.innerWidth / 2;
    pillAnchorY = window.innerHeight - 60;
    pillSpringX.setTarget(pillAnchorX);
    pillSpringY.setTarget(pillAnchorY);
  }

  function pillSnapToEdge() {
    const vw = window.innerWidth;
    const x = pillSpringX.position;
    pillAnchorX = x < vw / 2 ? 80 : vw - 80;
    pillAnchorY = window.innerHeight - 60;
    pillSpringX.setTarget(pillAnchorX);
    pillSpringY.setTarget(pillAnchorY);
  }

  function pillSnapToTopCenter() {
    pillAnchorX = window.innerWidth / 2;
    pillAnchorY = 60;
    pillSpringX.setTarget(pillAnchorX);
    pillSpringY.setTarget(pillAnchorY);
  }

  // Pointer-drag with inertia
  pill.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pill-btn')) return; // Don't drag on button clicks
    pillDragging = true;
    pillHasMoved = false;
    pillDragStartX = e.clientX;
    pillDragStartY = e.clientY;
    pill.setPointerCapture(e.pointerId);
  });

  pill.addEventListener('pointermove', (e) => {
    if (!pillDragging) return;
    const dx = e.clientX - pillDragStartX;
    const dy = e.clientY - pillDragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pillHasMoved = true;
    // Set position directly (no spring during drag)
    pillSpringX.position = pillAnchorX + dx;
    pillSpringY.position = pillAnchorY + dy;
    pillSpringX._settled = true;
    pillSpringY._settled = true;
  });

  pill.addEventListener('pointerup', (e) => {
    if (!pillDragging) return;
    pillDragging = false;
    const dx = e.clientX - pillDragStartX;
    const dy = e.clientY - pillDragStartY;
    // Apply velocity as impulse for inertia
    const velocityScale = 8;
    pillSpringX.applyImpulse(dx * velocityScale);
    pillSpringY.applyImpulse(dy * velocityScale);
    // Settle to nearest edge
    const vw = window.innerWidth;
    if (pillHasMoved) {
      if (Math.abs(pillAnchorX + dx - vw / 2) < vw * 0.3) {
        pillSnapToAnchor();
      } else {
        pillSnapToEdge();
      }
    }
  });

  // Double-click to collapse/expand
  pill.addEventListener('dblclick', (e) => {
    if (e.target.closest('.pill-btn')) return;
    togglePill();
  });

  function togglePill() {
    pillCollapsed = !pillCollapsed;
    if (pillCollapsed) {
      pillBody.style.opacity = '0';
      pillBody.style.transform = 'scale(0.5)';
      pillBody.style.pointerEvents = 'none';
      setTimeout(() => { pillBody.style.display = 'none'; }, 200);
      pillBubble.style.display = 'flex';
      setTimeout(() => { pillBubble.style.opacity = '1'; pillBubble.style.transform = 'scale(1)'; }, 10);
    } else {
      pillBubble.style.display = 'none';
      pillBody.style.display = 'flex';
      setTimeout(() => { pillBody.style.opacity = '1'; pillBody.style.transform = 'scale(1)'; }, 10);
    }
  }

  // Click bubble to expand
  pillBubble.addEventListener('click', () => {
    if (pillCollapsed) togglePill();
  });

  // Pill button actions
  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'back') api.invoke('tabs:goBack', activeId);
      else if (action === 'forward') api.invoke('tabs:goForward', activeId);
      else if (action === 'home') navigate('am://start');
      else if (action === 'newTab') api.invoke('tabs:create', {});
      else if (action === 'menu') openPanel(panels.settings);
    });
  });

  // Window resize: update anchor
  window.addEventListener('resize', () => {
    if (!pillDragging) pillSnapToAnchor();
  });

  pillInit();

  /* ── Wire sidebar & header events ──────────────────────── */
  $('btnSettings').addEventListener('click', () => openPanel(panels.settings));
  $('btnHistory').addEventListener('click', () => openPanel(panels.history));
  $('btnBookmarks').addEventListener('click', () => openPanel(panels.bookmarks));
  $('btnDownloads').addEventListener('click', () => openPanel(panels.downloads));
  $('btnNewTab').addEventListener('click', () => api.invoke('tabs:create', {}));
  $('panelHistoryClose').addEventListener('click', closePanels);
  $('panelBookmarksClose').addEventListener('click', closePanels);
  $('panelDownloadsClose').addEventListener('click', closePanels);
  $('panelSettingsClose').addEventListener('click', closePanels);
  $('panelSiteSettingsClose').addEventListener('click', closePanels);
  $('historyClearBtn').addEventListener('click', async () => { if (confirm(i18n.t('dialog.clearHistory'))) { await api.invoke('history:clear'); renderHistory(); } });
  $('bookmarksClearBtn').addEventListener('click', async () => { if (confirm(i18n.t('dialog.clearBookmarks'))) { await api.invoke('bookmarks:getAll').then((bms) => Promise.all(bms.map((b) => api.invoke('bookmarks:remove', b.id)))); renderBookmarks(); } });
  $('downloadsClearBtn').addEventListener('click', async () => { await api.invoke('downloads:clear'); renderDownloads(); });
  $('historySearch').addEventListener('input', renderHistory);
  $('omniboxAction').addEventListener('click', () => openPanel(panels.siteSettings));
  $('btnMinimize').addEventListener('click', () => api.invoke('window:minimize'));
  $('btnMaximize').addEventListener('click', () => api.invoke('window:maximize'));
  $('btnClose').addEventListener('click', () => api.invoke('window:close'));

  /* ── Toast ──────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /* ── Keyboard shortcuts ─────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    const mods = e.ctrlKey || e.metaKey;
    if (mods) {
      if (e.key === 't') { e.preventDefault(); api.invoke('tabs:create', {}); }
      if (e.key === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); }
      if (e.key === 'w') { e.preventDefault(); api.invoke('tabs:close', activeId); }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        api.invoke('tabs:getCurrentUrl').then(async ({ url }) => {
          if (!url) return;
          const existing = await api.invoke('bookmarks:getByUrl', url);
          if (existing) { await api.invoke('bookmarks:remove', existing.id); toast(i18n.t('bookmarks.removed')); }
          else { await api.invoke('bookmarks:add', { url, title: activeTitle }); toast(i18n.t('bookmarks.added')); }
        });
      }
    }
    if (e.alt && e.key === 'ArrowLeft') api.invoke('tabs:goBack', activeId);
    if (e.alt && e.key === 'ArrowRight') api.invoke('tabs:goForward', activeId);
  });

  /* ── IPC events from main ───────────────────────────────── */
  api.on('tabs:changed', (tabs, activeTabId, url, title) => {
    allTabs = tabs;
    activeId = activeTabId;
    activeUrl = url || '';
    activeTitle = title || '';
    renderTabs();
    syncAddressBar();
  });

  api.on('tabs:focusAddressBar', () => { urlInput.focus(); urlInput.select(); });
  api.on('window:maximized', (isMax) => { $('btnMaximize').textContent = isMax ? '❐' : '□'; });
  api.on('downloads:changed', () => { if (currentPanel === panels.downloads) renderDownloads(); });

  /* ── Init ───────────────────────────────────────────────── */
  (async () => {
    await i18n.init();
    applyI18n();
    try {
      const active = await api.invoke('tabs:getAll');
      const activeTab = await api.invoke('tabs:getActiveId');
      if (Array.isArray(active)) { allTabs = active; activeId = activeTab; }
    } catch {}
    renderTabs();
    syncAddressBar();
  })();
})();
