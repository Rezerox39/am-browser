'use strict';

const { app, dialog } = require('electron');
const path = require('path');
const config = require('./config');
const windowManager = require('./window');
const security = require('./security');
const adblockService = require('./adblock');
const downloadsManager = require('./downloads');
const ipcHandler = require('./ipc');
const tabsManager = require('./tabs');
const extensionsManager = require('./extensions');
const extManager = require('./extensions/manager');
const logger = require('./logger');
const { setLocale } = require('../shared/i18n');
const { protocol } = require('electron');

function serveAdblockPage() {
  const adblock = require('./adblock');
  const cfg = config.get().adblock;
  const st = adblock.stats();
  const recent = adblock.getRecentMatches();
  const blocked = recent.filter(r => r.blocked);
  const allowed = recent.filter(r => !r.blocked);

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>AM — Adblock</title>
<style>
  body { background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; margin: 0; }
  h1 { font-size: 20px; margin-bottom: 24px; color: #5a83ff; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #606060; margin: 24px 0 12px; border-bottom: 1px solid #1a1a1a; padding-bottom: 6px; }
  .row { display: flex; gap: 32px; flex-wrap: wrap; }
  .stat { min-width: 200px; }
  .stat .label { font-size: 12px; color: #a0a0a0; }
  .stat .value { font-size: 22px; font-weight: 600; color: #fff; margin-top: 2px; }
  .stat .value.green { color: #28c840; }
  .stat .value.red { color: #ff5f57; }
  .match { padding: 6px 12px; margin: 4px 0; border-radius: 8px; font-size: 12px; font-family: monospace; word-break: break-all; }
  .match.blocked { background: rgba(255, 95, 87, 0.12); border: 1px solid rgba(255, 95, 87, 0.2); color: #ff8a80; }
  .match.allowed { background: rgba(40, 200, 64, 0.08); border: 1px solid rgba(40, 200, 64, 0.15); color: #81c784; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-right: 8px; }
  .tag.block { background: rgba(255, 95, 87, 0.2); color: #ff5f57; }
  .tag.allow { background: rgba(40, 200, 64, 0.15); color: #28c840; }
  .limitation { background: rgba(90, 131, 255, 0.1); border: 1px solid rgba(90, 131, 255, 0.2); border-radius: 8px; padding: 16px; margin-top: 24px; font-size: 13px; line-height: 1.6; }
  .limitation strong { color: #5a83ff; }
</style></head><body>
<h1>Adblock Diagnostics</h1>
<h2>Status</h2>
<div class="row">
  <div class="stat"><div class="label">Enabled</div><div class="value ${cfg.enabled ? 'green' : 'red'}">${cfg.enabled ? 'YES' : 'NO'}</div></div>
  <div class="stat"><div class="label">Rules Loaded</div><div class="value">${st.rules}</div></div>
  <div class="stat"><div class="label">Requests Blocked</div><div class="value red">${st.blocked}</div></div>
  <div class="stat"><div class="label">Requests Allowed</div><div class="value green">${st.allowed}</div></div>
  <div class="stat"><div class="label">Session</div><div class="value" style="font-size:14px">defaultSession</div></div>
</div>
<h2>Recent Requests (last ${recent.length})</h2>
${blocked.map(r => '<div class="match blocked"><span class="tag block">BLOCK</span><span class="tag">' + r.type + '</span>' + r.url + '</div>').join('')}
${allowed.slice(-10).map(r => '<div class="match allowed"><span class="tag allow">ALLOW</span><span class="tag">' + r.type + '</span>' + r.url + '</div>').join('')}
<h2>YouTube / Video Ad Limitation</h2>
<div class="limitation">
  <strong>Why YouTube ads may still appear:</strong><br>
  YouTube serves ads from the same origin (<code>youtube.com</code>) as normal video
  content. The ad decision is made server-side and the ad is delivered through the
  same video streaming infrastructure (DASH/HLS). Network-level ad blockers cannot
  distinguish between an ad segment and a real video segment when they share the
  same URL pattern and CDN.<br><br>
  This browser's adblocker <strong>does block</strong> known third-party ad networks
  (Google DoubleClick, Taboola, Outbrain, Amazon Ads, etc.) and tracker scripts.
  It cannot block ads that are embedded in first-party video streams without breaking
  video playback entirely.
</div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function serveExtensionsPage() {
  const exts = extManager.listExtensions();
  const extRows = exts.map(ext => {
    const errors = extManager.getExtensionErrors(ext.id);
    const errorCount = errors.errors ? errors.errors.length : 0;
    const statusClass = ext.enabled ? 'green' : 'dim';
    const statusText = ext.enabled ? 'Enabled' : 'Disabled';
    const permissions = ext.permissions || [];
    const hostPerms = ext.hostPermissions || [];
    const popup = ext.manifest && ext.manifest.action && ext.manifest.action.default_popup;

    return '<div class="ext-card">' +
      '<div class="ext-header">' +
        '<div class="ext-info">' +
          '<div class="ext-name">' + (ext.name || 'Unknown') + '</div>' +
          '<div class="ext-meta">v' + (ext.version || '?') + ' · ' + ext.id.substring(0, 12) + '…</div>' +
          (ext.description ? '<div class="ext-desc">' + ext.description + '</div>' : '') +
        '</div>' +
        '<div class="ext-status ' + statusClass + '">' + statusText + '</div>' +
      '</div>' +
      (permissions.length || hostPerms.length ?
        '<div class="ext-perms">' +
          permissions.map(p => '<span class="perm-tag">' + p + '</span>').join('') +
          hostPerms.map(p => '<span class="perm-tag host">' + p + '</span>').join('') +
        '</div>' : '') +
      (errorCount > 0 ? '<div class="ext-errors">⚠ ' + errorCount + ' error(s)</div>' : '') +
      '<div class="ext-actions">' +
        (popup ? '<a class="ext-btn" href="javascript:void(0)" onclick="openExtPopup(\'' + ext.id + '\')">Popup</a>' : '') +
        '<a class="ext-btn" href="am://extensions?id=' + ext.id + '">Details</a>' +
      '</div>' +
    '</div>';
  }).join('');

  const compatibilityTable = [
    { api: 'Manifest V2/V3', status: '✓' },
    { api: 'Content Scripts', status: '✓' },
    { api: 'chrome.storage.local', status: '✓' },
    { api: 'chrome.runtime', status: '✓' },
    { api: 'chrome.tabs (partial)', status: '⚠ Partial' },
    { api: 'chrome.webRequest', status: '✓' },
    { api: 'chrome.contextMenus', status: '✓' },
    { api: 'Extension popups', status: '✓' },
    { api: 'Developer mode', status: '✓' },
    { api: 'DeclarativeNetRequest', status: '⚠ Limited' },
  ];
  const compatRows = compatibilityTable.map(r =>
    '<div class="compat-row"><span class="compat-api">' + r.api + '</span><span class="compat-status">' + r.status + '</span></div>'
  ).join('');

  const extCount = exts.length;
  const enabledCount = exts.filter(e => e.enabled).length;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>AM — Extensions</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; margin: 0; }
  h1 { font-size: 22px; margin-bottom: 8px; color: #5a83ff; font-weight: 700; }
  .subtitle { font-size: 13px; color: #606060; margin-bottom: 24px; }
  .stats { display: flex; gap: 32px; margin-bottom: 28px; }
  .stat-box { min-width: 120px; }
  .stat-box .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #606060; }
  .stat-box .value { font-size: 20px; font-weight: 600; color: #fff; margin-top: 2px; }
  .stat-box .value.green { color: #28c840; }
  .ext-card {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px; padding: 16px; margin-bottom: 12px;
    transition: border-color 0.15s ease;
  }
  .ext-card:hover { border-color: rgba(90,131,255,0.2); }
  .ext-header { display: flex; justify-content: space-between; align-items: flex-start; }
  .ext-name { font-size: 15px; font-weight: 600; color: #fff; }
  .ext-meta { font-size: 11px; color: #606060; margin-top: 2px; font-family: monospace; }
  .ext-desc { font-size: 12px; color: #a0a0a0; margin-top: 4px; line-height: 1.4; }
  .ext-status { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 12px; }
  .ext-status.green { background: rgba(40,200,64,0.15); color: #28c840; }
  .ext-status.dim { background: rgba(255,255,255,0.06); color: #606060; }
  .ext-perms { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .perm-tag { font-size: 10px; padding: 2px 8px; border-radius: 4px; background: rgba(90,131,255,0.1); color: #5a83ff; }
  .perm-tag.host { background: rgba(255,165,0,0.1); color: #ffa500; }
  .ext-errors { font-size: 11px; color: #ff5f57; margin-top: 6px; }
  .ext-actions { display: flex; gap: 8px; margin-top: 10px; }
  .ext-btn {
    font-size: 12px; padding: 5px 12px; border-radius: 6px; text-decoration: none;
    border: 1px solid rgba(255,255,255,0.08); color: #a0a0a0;
    transition: all 0.15s ease; cursor: pointer;
  }
  .ext-btn:hover { color: #fff; background: rgba(255,255,255,0.06); }
  .section { margin-top: 32px; }
  .section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #606060; margin-bottom: 12px; border-bottom: 1px solid #1a1a1a; padding-bottom: 6px; }
  .compat-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
  .compat-api { color: #a0a0a0; }
  .compat-status { color: #28c840; }
  .info { background: rgba(90,131,255,0.08); border: 1px solid rgba(90,131,255,0.15); border-radius: 8px; padding: 16px; margin-top: 24px; font-size: 13px; line-height: 1.6; color: #a0a0a0; }
  .info strong { color: #5a83ff; }
  .info code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .dev-section { margin-top: 24px; padding: 16px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px; }
  .empty { text-align: center; padding: 32px; color: #606060; font-size: 14px; }
</style>
<script>
function openExtPopup(id) {
  fetch('/extensions-popup/' + id).catch(() => {});
}
</script></head><body>
<h1>Extensions</h1>
<div class="subtitle">${extCount} installed · ${enabledCount} enabled</div>

<div class="stats">
  <div class="stat-box"><div class="label">Installed</div><div class="value">${extCount}</div></div>
  <div class="stat-box"><div class="label">Enabled</div><div class="value green">${enabledCount}</div></div>
</div>

${extCount > 0 ? extRows : '<div class="empty">No extensions installed.<br>Use Developer Mode to load unpacked extensions.</div>'}

<div class="dev-section">
  <h2>Developer Mode</h2>
  <p style="font-size:12px;color:#606060;margin-bottom:8px;">To install an unpacked extension, copy it to:<br>
  <code style="color:#5a83ff;font-size:11px;">${app.getPath('userData')}/extensions/installed/</code></p>
</div>

<div class="section">
  <h2>Electron Extension API Compatibility</h2>
  ${compatRows}
</div>

<div class="info">
  <strong>Chrome Web Store:</strong> Supported via <code>electron-chrome-web-store</code>.
  Not all store extensions work — Electron does not aim for complete Chrome compatibility.<br><br>
  <strong>Content scripts:</strong> MV3 content scripts are injected by Electron's extension system automatically.<br><br>
  <strong>Extension popups:</strong> Click Popup on an installed extension to test its popup UI.<br><br>
  <strong>AM limitations:</strong> Electron does not support <code>chrome.declarativeNetRequest</code> fully,
  and some <code>chrome.tabs</code> APIs are partial. See the compatibility table above.
</div>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// Make errors VISIBLE
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { logger.error('main', 'Uncaught exception', { error: err.message, stack: err.stack }); } catch {}
  try { dialog.showErrorBox('AM — Unexpected Error', err.message + '\n\n' + (err.stack || '')); } catch {}
  try { app.quit(); } catch {}
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  try { logger.error('main', 'Unhandled rejection', { reason: String(reason) }); } catch {}
});

let gotLock = false;
try { gotLock = app.requestSingleInstanceLock(); } catch {}
if (!gotLock) { logger.warn('main', 'Single instance lock not acquired — proceeding anyway'); }
app.on('second-instance', () => { windowManager.focus(); });

config.load();
const cfg = config.get();
setLocale(cfg.language || 'en');
app.setName('AM');
if (process.platform === 'win32') { try { app.setAppUserModelId('com.am.browser'); } catch {} }

extensionsManager.announceSchemes();

app.whenReady().then(async () => {
  protocol.handle('am', (request) => {
    const url = request.url.toLowerCase();
    if (url === 'am://adblock') return serveAdblockPage();
    if (url === 'am://extensions' || url.startsWith('am://extensions?')) return serveExtensionsPage();
    return new Response('Unknown am:// page', { status: 404, headers: { 'content-type': 'text/plain' } });
  });
  try {
    security.harden();
    downloadsManager.init();
    adblockService.init();
    const win = windowManager.create();
    downloadsManager.setWindow(win);
    ipcHandler.register(win);
    tabsManager.init({ window: win, url: cfg.homePage === 'start' ? '' : cfg.homePage });

    extManager.init();
    try {
      const loadResults = await extManager.loadPersistedExtensions();
      logger.info('extensions', 'Loaded ' + loadResults.length + ' persisted extension(s)');
    } catch (e) { logger.warn('extensions', 'Persisted extension load failed', { error: e.message }); }

    try {
      await extensionsManager.init(win);
      extensionsManager.wireContextMenu();
    } catch (e) { logger.error('extensions', 'Failed to init extensions', { error: e.message }); }

    logger.info('main', 'App startup complete');
  } catch (err) {
    console.error('Startup error:', err);
    logger.error('main', 'Startup error', { error: err.message });
    dialog.showErrorBox('AM — Startup Error', 'Failed to start the browser:\n\n' + err.message);
    app.quit();
  }
});

app.on('activate', () => {
  if (!windowManager.getWindow()) {
    const win = windowManager.create();
    downloadsManager.setWindow(win);
    ipcHandler.register(win);
    tabsManager.init({ window: win });
  }
});

app.on('window-all-closed', () => { config.saveNow(); app.quit(); });
process.on('SIGINT', () => { config.saveNow(); app.quit(); });
process.on('SIGTERM', () => { config.saveNow(); app.quit(); });
