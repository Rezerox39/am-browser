'use strict';

/* =============================================================
   AM — Renderer entry point (the browser chrome).
   All strings come from the i18n provider (see t()/i18n()).
   All IPC goes through window.am (contextBridge whitelist).
   ============================================================= */

(() => {
  const api = window.am;
  if (!api) {
    document.body.innerHTML = '<h1>Preload unavailable</h1>';
    return;
  }

  // ── Tiny i18n client ─────────────────────────────────────────
  // Locale files are resolved by the main process; this module just
  // needs to reflect whatever strings main already selected. We load
  // them via a fetched dictionary of the active language.
  const i18n = {
    strings: {},
    fallback: {},
    async init() {
      try {
        const available = await api.invoke('i18n:getAvailable');
        // main already picked the active locale; we fetch all and pick.
        // To keep it simple, the main process exposes no direct 'get strings',
        // so we rely on small mapping fetched structures. See loadFor below.
        this.available = available || [];
        const settings = await api.invoke('settings:get');
        await this.loadFor(settings.language || 'en');
      } catch (e) {
        console.error('i18n init failed', e);
      }
    },
    async loadFor(locale) {
      // Locale files live in the shared folder; expose them as a data snapshot.
      // We request main for the matching JSON via a dedicated IPC-less approach:
      // Since preload whitelist prevents arbitrary fetches, ask main to return
      // translations through settings proxy. Simpler: main adds strings at top.
      try {
        const res = await fetch('i18n/locales/' + locale + '.json');
        this.strings = await res.json();
      } catch (e) {
        this.strings = this.fallback;
      }
      if (locale !== 'en' && Object.keys(this.fallback).length === 0) {
        try { this.fallback = await (await fetch('i18n/locales/en.json')).json(); } catch {}
      }
    },
    t(key, vars) {
      let val = this.strings[key] || this.fallback[key] || key;
      if (vars && typeof val === 'string') {
        for (const [k, v] of Object.entries(vars)) {
          val = val.split('{{' + k + '}}').join(String(v));
        }
      }
      return val;
    },
  };

  // ── DOM refs ─────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const urlInput = $('urlInput');
  const omniboxLock = $('omniboxLock');
  const tabList = $('tabList');
  const panelHistory = $('panelHistory');
  const panelBookmarks = $('panelBookmarks');
  const panelDownloads = $('panelDownloads');
  const panelSettings = $('panelSettings');
  const panelSiteSettings = $('panelSiteSettings');
  const settingsPanel = $('settingsPanel');
  const siteSettingsPanel = $('siteSettingsPanel');

  let allTabs = [];
  let activeId = null;
  let activeUrl = '';
  let activeTitle = '';
  let currentPanel = null;

  // ── i18n apply to DOM ────────────────────────────────────────
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = i18n.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = i18n.t(key);
    });
  }

  // ── Fun favicon ──────────────────────────────────────────────
  function faviconFor(url) {
    try {
      const u = new URL(url);
      return u.hostname[0] ? u.hostname[0].toUpperCase() : '·';
    } catch {
      return '·';
    }
  }

  // ── Tab list rendering ───────────────────────────────────────
  function renderTabs() {
    tabList.innerHTML = '';
    for (const tab of allTabs) {
      const el = document.createElement('div');
      el.className = 'pill-tab' + (tab.id === activeId ? ' active' : '');
      el.dataset.tabId = tab.id;
      el.addEventListener('click', () => api.invoke('tabs:setActive', tab.id));
      el.addEventListener('dblclick', (e) => {
        if (e.target.classList && e.target.classList.contains('tab-close-btn')) return;
      });

      const glow = document.createElement('span');
      glow.className = 'tab-glow';

      const icon = document.createElement('span');
      icon.className = 'tab-icon';
      icon.textContent = tab.loading ? '⟳' : faviconFor(tab.url);

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || 'New Tab';

      const close = document.createElement('button');
      close.className = 'tab-close-btn';
      close.textContent = '✕';
      close.title = i18n.t('tab.close');
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        api.send('tabs:close', tab.id);
      });

      el.appendChild(glow);
      el.appendChild(icon);
      el.appendChild(title);
      el.appendChild(close);
      tabList.appendChild(el);
    }
  }

  // ── Address bar sync ─────────────────────────────────────────
  function syncAddressBar() {
    if (document.activeElement === urlInput) return;
    urlInput.value = activeUrl || '';
    const secure = activeUrl.startsWith('https://') || activeUrl.startsWith('am://');
    omniboxLock.className = secure ? '' : 'idle';
    omniboxLock.textContent = secure ? '🔒' : '🌐';
    $('omniboxAction').classList.toggle('muted', !activeUrl);
  }

  // ── Panels ───────────────────────────────────────────────────
  function closePanels() {
    [panelHistory, panelBookmarks, panelDownloads, panelSettings, panelSiteSettings].forEach((p) => {
      p.style.display = 'none';
    });
    currentPanel = null;
  }

  function openPanel(panel) {
    closePanels();
    panel.style.display = 'flex';
    currentPanel = panel;
    refreshPanel(panel);
  }

  async function refreshPanel(panel) {
    if (panel === panelHistory) await renderHistory();
    else if (panel === panelBookmarks) await renderBookmarks();
    else if (panel === panelDownloads) await renderDownloads();
    else if (panel === panelSettings) await renderSettings();
    else if (panel === panelSiteSettings) await renderSiteSettings();
  }

  function empty(listEl, key) {
    listEl.innerHTML = '<div class="empty-state">' + i18n.t(key) + '</div>';
  }

  async function renderHistory() {
    const list = $('historyList');
    const q = $('historySearch').value.trim();
    let items;
    try {
      items = q
        ? await api.invoke('history:search', q, 50)
        : await api.invoke('history:getRecent', 100);
    } catch (e) {
      return empty(list, 'error.title');
    }
    if (!items.length) return empty(list, 'history.empty');
    list.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'panel-item';
      row.addEventListener('click', () => {
        navigate(item.url);
        closePanels();
      });
      const fav = document.createElement('span');
      fav.className = 'item-favicon';
      fav.textContent = faviconFor(item.url);
      const main = document.createElement('div');
      main.className = 'item-main';
      const t = document.createElement('div');
      t.className = 'item-title';
      t.textContent = item.title || item.url;
      const u = document.createElement('div');
      u.className = 'item-url';
      u.textContent = item.url;
      main.appendChild(t);
      main.appendChild(u);
      row.appendChild(fav);
      row.appendChild(main);
      list.appendChild(row);
    }
  }

  async function renderBookmarks() {
    const list = $('bookmarksList');
    let items;
    try { items = await api.invoke('bookmarks:getAll'); } catch (e) {
      return empty(list, 'error.title');
    }
    if (!items.length) return empty(list, 'bookmarks.empty');
    list.innerHTML = '';
    for (const bm of items) {
      const row = document.createElement('div');
      row.className = 'panel-item';
      row.addEventListener('click', () => {
        navigate(bm.url);
        closePanels();
      });
      const fav = document.createElement('span');
      fav.className = 'item-favicon';
      fav.textContent = faviconFor(bm.url);
      const main = document.createElement('div');
      main.className = 'item-main';
      const t = document.createElement('div');
      t.className = 'item-title';
      t.textContent = bm.title || bm.url;
      const u = document.createElement('div');
      u.className = 'item-url';
      u.textContent = bm.url;
      main.appendChild(t);
      main.appendChild(u);
      const del = document.createElement('button');
      del.className = 'item-action';
      del.textContent = '✕';
      del.title = i18n.t('bookmarks.removed');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api.invoke('bookmarks:remove', bm.id);
        renderBookmarks();
      });
      row.appendChild(fav);
      row.appendChild(main);
      row.appendChild(del);
      list.appendChild(row);
    }
  }

  async function renderDownloads() {
    const list = $('downloadsList');
    let items;
    try { items = await api.invoke('downloads:getAll'); } catch (e) {
      return empty(list, 'error.title');
    }
    if (!items.length) return empty(list, 'downloads.empty');
    list.innerHTML = '';
    for (const dl of items) {
      const row = document.createElement('div');
      row.className = 'panel-item';
      const main = document.createElement('div');
      main.className = 'item-main';
      const t = document.createElement('div');
      t.className = 'item-title';
      t.textContent = dl.filename;
      const meta = document.createElement('div');
      meta.className = 'item-url';
      let stateStr = i18n.t('downloads.complete');
      if (dl.state === 'progressing') stateStr = i18n.t('downloads.downloading');
      else if (dl.state === 'failed') stateStr = i18n.t('downloads.failed');
      else if (dl.state === 'cancelled') stateStr = i18n.t('downloads.cancelled');
      meta.textContent = stateStr + ' · ' + fmtBytes(dl.receivedBytes || dl.totalBytes);
      main.appendChild(t);
      main.appendChild(meta);
      const act = document.createElement('button');
      act.className = 'item-action';
      act.textContent = dl.state === 'complete' ? '↯' : '✕';
      act.title = dl.state === 'complete' ? i18n.t('downloads.open') : i18n.t('downloads.remove');
      act.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (dl.state === 'complete' && dl.savePath) {
          await api.invoke('downloads:openFile', dl.savePath);
        } else {
          await api.invoke('downloads:remove', dl.id);
          renderDownloads();
        }
      });
      row.appendChild(main);
      row.appendChild(act);
      list.appendChild(row);
    }
  }

  function fmtBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  async function renderSettings() {
    const cfg = await api.invoke('settings:get');
    const available = await api.invoke('i18n:getAvailable');
    settingsPanel.innerHTML = '';

    settingsPanel.appendChild(section('settings.general'));
    settingsPanel.appendChild(row(cfg, 'settings.language', 'language', {
      type: 'select',
      options: available.map((l) => ({ value: l, label: l.toUpperCase() })),
      value: cfg.language,
      onChange: async (val) => {
        await api.invoke('settings:set', 'language', val);
        await i18n.loadFor(val);
        applyI18n();
        renderSettings();
      },
    }));
    settingsPanel.appendChild(row(cfg, 'settings.searchEngine', 'searchEngine', {
      type: 'select',
      options: [
        { value: 'google', label: 'Google' },
        { value: 'bing', label: 'Bing' },
        { value: 'duckduckgo', label: 'DuckDuckGo' },
      ],
      value: cfg.searchEngine,
      onChange: (val) => api.invoke('settings:set', 'searchEngine', val),
    }));
    settingsPanel.appendChild(row(cfg, 'settings.homePage', 'homePage', {
      type: 'text', value: cfg.homePage,
      onChange: (val) => api.invoke('settings:set', 'homePage', val),
    }));

    settingsPanel.appendChild(section('settings.adblocking'));
    settingsPanel.appendChild(row(cfg, 'settings.adblockEnabled', 'adblockEnabled', {
      type: 'toggle', checked: cfg.adblock.enabled,
      onChange: (val) => {
        cfg.adblock.enabled = val;
        api.invoke('settings:set', 'adblock', cfg.adblock);
      },
    }));
    const stats = await api.invoke('adblock:getStats').catch(() => null);
    if (stats) {
      settingsPanel.appendChild(row(cfg, 'settings.adblockStats', 'adblockStats', {
        type: 'static', text: String(stats.blocked),
      }));
    }

    settingsPanel.appendChild(section('settings.downloads'));
    settingsPanel.appendChild(row(cfg, 'settings.askWhereToSave', 'askWhereToSave', {
      type: 'toggle', checked: cfg.askWhereToSave,
      onChange: (val) => api.invoke('settings:set', 'askWhereToSave', val),
    }));
    settingsPanel.appendChild(row(cfg, 'settings.blockPopups', 'blockPopups', {
      type: 'toggle', checked: cfg.blockPopups,
      onChange: (val) => api.invoke('settings:set', 'blockPopups', val),
    }));

    settingsPanel.appendChild(section('settings.advanced'));
    settingsPanel.appendChild(storageRow());

    function section(key) {
      const el = document.createElement('div');
      el.className = 'settings-section-title';
      el.textContent = i18n.t(key);
      return el;
    }

    function row(cfg, labelKey, fieldKey, opt) {
      const wrap = document.createElement('div');
      wrap.className = 'setting-row';
      const label = document.createElement('div');
      const l = document.createElement('div');
      l.className = 'setting-label';
      l.textContent = i18n.t(labelKey);
      label.appendChild(l);
      const control = document.createElement('div');
      control.className = 'setting-control';
      if (opt.type === 'select') {
        const sel = document.createElement('select');
        for (const o of opt.options) {
          const op = document.createElement('option');
          op.value = o.value; op.textContent = o.label;
          if (o.value === opt.value) op.selected = true;
          sel.appendChild(op);
        }
        sel.addEventListener('change', () => opt.onChange(sel.value));
        control.appendChild(sel);
      } else if (opt.type === 'text') {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.value = opt.value || '';
        inp.placeholder = '\u2026';
        inp.addEventListener('change', () => opt.onChange(inp.value.trim()));
        control.appendChild(inp);
      } else if (opt.type === 'toggle') {
        control.appendChild(toggle(fieldKey, opt.checked, opt.onChange));
      } else if (opt.type === 'static') {
        const s = document.createElement('span');
        s.className = 'setting-hint';
        s.textContent = opt.text;
        control.appendChild(s);
      }
      wrap.appendChild(label);
      wrap.appendChild(control);
      return wrap;
    }

    function storageRow() {
      const wrap = document.createElement('div');
      wrap.className = 'setting-row';
      const label = document.createElement('div');
      const l = document.createElement('div');
      l.className = 'setting-label';
      l.textContent = i18n.t('settings.clearData');
      label.appendChild(l);
      const control = document.createElement('div');
      control.className = 'setting-control';
      const btn = document.createElement('button');
      btn.className = 'panel-action-btn';
      btn.textContent = i18n.t('settings.clearHistory');
      btn.style.width = 'auto';
      btn.addEventListener('click', async () => {
        if (confirm(i18n.t('dialog.clearHistory'))) {
          await api.invoke('history:clear');
          toast(i18n.t('history.title') + ' ✓');
        }
      });
      control.appendChild(btn);
      wrap.appendChild(label);
      wrap.appendChild(control);
      return wrap;
    }
  }

  async function renderSiteSettings() {
    if (!activeUrl) {
      siteSettingsPanel.innerHTML = '<div class="empty-state">—</div>';
      return;
    }
    let host;
    try { host = new URL(activeUrl).hostname; } catch {
      siteSettingsPanel.innerHTML = '<div class="empty-state">—</div>';
      return;
    }
    let rule;
    try { rule = await api.invoke('site:getRule', host); } catch { rule = {}; }
    rule = rule || {};

    siteSettingsPanel.innerHTML = '';
    const hostEl = document.createElement('div');
    hostEl.className = 'site-host';
    hostEl.textContent = host;
    siteSettingsPanel.appendChild(hostEl);

    siteSettingsPanel.appendChild(siteRow('site.adblock', 'adblock', rule.adblockEnabled !== undefined ? rule.adblockEnabled : null, (val) => {
      const v = val === null ? true : val;
      rule.adblockEnabled = v;
      save(host, rule);
      $('omniboxAction').classList.toggle('muted', !v);
    }));

    siteSettingsPanel.appendChild(siteRow('site.javascript', 'javascript', rule.javascript !== undefined ? rule.javascript : null, (val) => {
      rule.javascript = val;
      save(host, rule);
    }));

    siteSettingsPanel.appendChild(siteRow('site.popups', 'popups', rule.popups !== undefined ? rule.popups : null, (val) => {
      rule.popups = val;
      save(host, rule);
    }));

    // User Agent
    const uaSection = document.createElement('div');
    uaSection.className = 'settings-section-title';
    uaSection.textContent = i18n.t('site.userAgent');
    siteSettingsPanel.appendChild(uaSection);

    const uaRow = document.createElement('div');
    uaRow.className = 'setting-row';
    uaRow.style.flexDirection = 'column';
    uaRow.style.alignItems = 'stretch';
    const uaLabel = document.createElement('div');
    uaLabel.className = 'setting-hint';
    uaLabel.textContent = i18n.t('settings.customUserAgent');
    const uaInput = document.createElement('textarea');
    uaInput.className = 'ua-input';
    uaInput.value = rule.userAgent || '';
    uaInput.placeholder = i18n.t('site.default');
    uaInput.addEventListener('change', () => {
      const v = uaInput.value.trim();
      if (v) rule.userAgent = v;
      else delete rule.userAgent;
      save(host, rule);
    });
    uaRow.appendChild(uaLabel);
    uaRow.appendChild(uaInput);
    siteSettingsPanel.appendChild(uaRow);

    // Permissions
    const permSection = document.createElement('div');
    permSection.className = 'settings-section-title';
    permSection.textContent = i18n.t('site.permissions');
    siteSettingsPanel.appendChild(permSection);

    const perms = rule.permissions || {};
    for (const perm of ['geolocation', 'notifications', 'media']) {
      siteSettingsPanel.appendChild(siteRow('site.' + perm, perm, perms[perm] !== undefined ? perms[perm] : null, (val) => {
        rule.permissions = rule.permissions || {};
        rule.permissions[perm] = val;
        save(host, rule);
      }));
    }

    function save(h, r) {
      api.invoke('site:setRule', h, r);
      toast(i18n.t('settings.confirm') + ' ✓');
    }

    function siteRow(labelKey, fieldKey, currentVal, onToggle) {
      const wrap = document.createElement('div');
      wrap.className = 'setting-row';
      const label = document.createElement('div');
      const l = document.createElement('div');
      l.className = 'setting-label';
      l.textContent = i18n.t(labelKey);
      label.appendChild(l);
      const control = document.createElement('div');
      control.className = 'setting-control';
      control.appendChild(toggle(fieldKey, currentVal === null ? false : !!currentVal, (checked) => {
        onToggle(checked);
      }, currentVal === null));
      wrap.appendChild(label);
      wrap.appendChild(control);
      return wrap;
    }
  }

  function toggle(id, checked, onChange, isDefault) {
    const label = document.createElement('label');
    label.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    if (checked) input.checked = true;
    input.addEventListener('change', () => onChange(input.checked));
    const info = document.createElement('span');
    info.className = 'setting-hint';
    info.textContent = isDefault ? i18n.t('site.default') : '';
    const track = document.createElement('span');
    track.className = 'track';
    label.appendChild(input);
    label.appendChild(track);
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.appendChild(label);
    if (isDefault) wrap.appendChild(info);
    return wrap;
  }

  // ── Navigation helpers ───────────────────────────────────────
  async function navigate(url) {
    const id = await api.invoke('tabs:getActiveId');
    await api.invoke('tabs:navigate', id, url);
  }

  function searchUrl(query) {
    const q = encodeURIComponent(query.trim());
    const engine = 'google';
    if (engine === 'google') return 'https://www.google.com/search?q=' + q;
    if (engine === 'bing') return 'https://www.bing.com/search?q=' + q;
    if (engine === 'duckduckgo') return 'https://duckduckgo.com/?q=' + q;
    return 'https://www.google.com/search?q=' + q;
  }

  function normalize(input) {
    const s = input.trim();
    if (!s) return '';
    if (/^am:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^about:/i.test(s) || /^data:/i.test(s)) return s;
    if (/^localhost(\/|$)/i.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s) && /\./.test(s)) {
      return 'https://' + s;
    }
    return searchUrl(s);
  }

  urlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = urlInput.value;
      const url = normalize(val);
      if (url) {
        urlInput.blur();
        await navigate(url);
      }
    }
  });

  // ── Wire events ──────────────────────────────────────────────
  $('btnBack').addEventListener('click', () => api.invoke('tabs:goBack', activeId));
  $('btnForward').addEventListener('click', () => api.invoke('tabs:goForward', activeId));
  $('btnReload').addEventListener('click', () => api.invoke('tabs:reload', activeId));
  $('btnNewTab').addEventListener('click', () => api.invoke('tabs:create', {}));
  $('btnSettings').addEventListener('click', () => openPanel(panelSettings));

  $('btnHome').addEventListener('click', () => navigate('am://start'));
  $('btnHistory').addEventListener('click', () => openPanel(panelHistory));
  $('btnBookmarks').addEventListener('click', () => openPanel(panelBookmarks));
  $('btnDownloads').addEventListener('click', () => openPanel(panelDownloads));

  $('panelHistoryClose').addEventListener('click', closePanels);
  $('panelBookmarksClose').addEventListener('click', closePanels);
  $('panelDownloadsClose').addEventListener('click', closePanels);
  $('panelSettingsClose').addEventListener('click', closePanels);
  $('panelSiteSettingsClose').addEventListener('click', closePanels);

  $('historyClearBtn').addEventListener('click', async () => {
    if (confirm(i18n.t('dialog.clearHistory'))) {
      await api.invoke('history:clear');
      renderHistory();
    }
  });
  $('bookmarksClearBtn').addEventListener('click', async () => {
    if (confirm(i18n.t('dialog.clearBookmarks'))) {
      await api.invoke('bookmarks:getAll').then((items) =>
        Promise.all(items.map((b) => api.invoke('bookmarks:remove', b.id))));
      renderBookmarks();
    }
  });
  $('downloadsClearBtn').addEventListener('click', async () => {
    await api.invoke('downloads:clear');
    renderDownloads();
  });

  $('historySearch').addEventListener('input', renderHistory);

  $('omniboxAction').addEventListener('click', () => openPanel(panelSiteSettings));

  $('btnMinimize').addEventListener('click', () => api.invoke('window:minimize'));
  $('btnMaximize').addEventListener('click', () => api.invoke('window:maximize'));
  $('btnClose').addEventListener('click', () => api.invoke('window:close'));

  // ── Toast ────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ── Keyboard shortcuts ───────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const mods = e.ctrlKey || e.metaKey;
    if (mods) {
      if (e.key === 't') api.invoke('tabs:create', {});
      if (e.key === 'l') {
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
      }
      if (e.key === 'w') {
        e.preventDefault();
        api.invoke('tabs:close', activeId);
      }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        api.invoke('tabs:getCurrentUrl').then(async ({ url }) => {
          if (!url) return;
          const existing = await api.invoke('bookmarks:getByUrl', url);
          if (existing) {
            await api.invoke('bookmarks:remove', existing.id);
            toast(i18n.t('bookmarks.removed'));
          } else {
            await api.invoke('bookmarks:add', { url, title: activeTitle });
            toast(i18n.t('bookmarks.added'));
          }
        });
      }
    }
    if (e.alt && e.key === 'ArrowLeft') api.invoke('tabs:goBack', activeId);
    if (e.alt && e.key === 'ArrowRight') api.invoke('tabs:goForward', activeId);
  });

  // ── IPC events from main ─────────────────────────────────────
  api.on('tabs:changed', (tabs, activeTabId, url, title) => {
    allTabs = tabs;
    activeId = activeTabId;
    activeUrl = url || '';
    activeTitle = title || '';
    renderTabs();
    syncAddressBar();
    $('btnBack').disabled = !allTabs.find((t) => t.id === activeId);
  });

  api.on('tabs:focusAddressBar', () => {
    urlInput.focus();
    urlInput.select();
  });

  api.on('window:maximized', (isMax) => {
    $('btnMaximize').textContent = isMax ? '❐' : '□';
  });

  api.on('downloads:changed', () => {
    if (currentPanel === panelDownloads) renderDownloads();
  });

  // ── Init ─────────────────────────────────────────────────────
  (async () => {
    await i18n.init();
    applyI18n();
    const s = await api.invoke('settings:get');
    const available = await api.invoke('i18n:getAvailable');
    if (s.language !== 'en') await i18n.loadFor(s.language);
    applyI18n();
    const active = await api.invoke('tabs:getAll');
    const activeTab = await api.invoke('tabs:getActiveId');
    if (Array.isArray(active)) {
      allTabs = active;
      activeId = activeTab;
    }
    renderTabs();
    syncAddressBar();
  })();
})();
