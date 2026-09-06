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

// Make errors VISIBLE — if anything fails before the window shows, the user sees a native dialog.
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

// Single instance lock — but do NOT quit if we lose the lock (a previous crashed
// process might still hold it). Just proceed; the worst case is two AM windows.
let gotLock = false;
try { gotLock = app.requestSingleInstanceLock(); } catch {}

if (!gotLock) {
  logger.warn('main', 'Single instance lock not acquired — proceeding anyway');
}

app.on('second-instance', () => {
  windowManager.focus();
});

// Load config first
config.load();
const cfg = config.get();

// Set locale
setLocale(cfg.language || 'en');

// Set app identity
app.setName('AM');
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.am.browser'); } catch {}
}

// Register privileged schemes before app is ready (required for extensions)
extensionsManager.announceSchemes();

// Register privileged am:// protocol for internal diagnostic pages.
// This MUST run before app.whenReady().
app.whenReady().then(async () => {
  protocol.handle('am', (request) => {
    const url = request.url.toLowerCase();
    if (url === 'am://adblock') {
      return serveAdblockPage();
    }
    return new Response('Unknown am:// page', { status: 404, headers: { 'content-type': 'text/plain' } });
  });
  try {
    // Security hardening (accesses session.defaultSession)
    security.harden();

    // Initialize download manager (accesses session.defaultSession)
    downloadsManager.init();

    // Initialize ad-block (accesses session.defaultSession)
    adblockService.init();

    // Create main window
    const win = windowManager.create();
    downloadsManager.setWindow(win);
    ipcHandler.register(win);
    tabsManager.init({ window: win, url: cfg.homePage === 'start' ? '' : cfg.homePage });

    // Initialize extension support
    try {
      await extensionsManager.init(win);
      extensionsManager.wireContextMenu();
    } catch (e) {
      logger.error('extensions', 'Failed to init extensions', { error: e.message });
    }

    logger.info('main', 'App startup complete');
  } catch (err) {
    console.error('Startup error:', err);
    logger.error('main', 'Startup error', { error: err.message });
    dialog.showErrorBox('AM — Startup Error', 'Failed to start the browser:\n\n' + err.message);
    app.quit();
  }
});

// macOS: re-create window when dock icon clicked
app.on('activate', () => {
  if (!windowManager.getWindow()) {
    const win = windowManager.create();
    downloadsManager.setWindow(win);
    ipcHandler.register(win);
    tabsManager.init({ window: win });
  }
});

app.on('window-all-closed', () => {
  config.saveNow();
  app.quit();
});

// Graceful shutdown
process.on('SIGINT', () => { config.saveNow(); app.quit(); });
process.on('SIGTERM', () => { config.saveNow(); app.quit(); });
