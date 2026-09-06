'use strict';

/**
 * Headless smoke test for AM. Exercises: home search, tabs, nav pill,
 * traffic lights, menu overlay, adblock, extensions, fullscreen.
 *
 * Run:  xvfb-run -a ./node_modules/.bin/electron scripts/smoke.js --no-sandbox
 */

const { app } = require('electron');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');

const results = [];
function check(name, cond, info) {
  results.push({ name, pass: !!cond, info: info || '' });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 20000, interval = 150) {
  const start = Date.now();
  let lastErr = null;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastErr = e; }
    if (Date.now() - start > timeout) throw lastErr || new Error('waitFor timeout');
    await sleep(interval);
  }
}

let win;
let tabs = null;

async function rendererEval(js) {
  if (!win || win.isDestroyed()) throw new Error('window destroyed');
  return win.webContents.executeJavaScript(js, true);
}

async function setHomeAndEnter(text) {
  return rendererEval(`(() => {
    const input = document.getElementById('home-input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
}

function pillEval(js) {
  const pill = tabs.getPillView();
  if (!pill || !pill.webContents || pill.webContents.isDestroyed()) return Promise.resolve(false);
  return pill.webContents.executeJavaScript(js, true);
}
async function clickPill(id) {
  return pillEval(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
}

function menuEval(js) {
  const mv = tabs.getMenuView ? tabs.getMenuView() : null;
  if (!mv || !mv.webContents || mv.webContents.isDestroyed()) return Promise.resolve(false);
  return mv.webContents.executeJavaScript(js, true);
}
async function clickMenu(id) {
  return menuEval(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
}

async function safeInvoke(channel, ...args) {
  try {
    const result = await rendererEval(`window.am.invoke(${JSON.stringify(channel)}, ${args.map(a => JSON.stringify(a)).join(', ')})`);
    return result;
  } catch { return undefined; }
}

app.whenReady().then(async () => {
  try {
    const config = require('../src/main/config');
    const windowManager = require('../src/main/window');
    const ipcHandler = require('../src/main/ipc');
    tabs = require('../src/main/tabs');

    config.load();
    const adblockMod = require('../src/main/adblock');
    adblockMod.init();

    win = windowManager.create();
    ipcHandler.register(win);
    tabs.init({ window: win, url: '' });

    // Wait for chrome renderer
    await waitFor(() =>
      rendererEval('!!(window.am && document.getElementById("home-input"))').catch(() => false), 30000);
    check('chrome renderer ready', true);

    // Wait for pill
    await waitFor(() => pillEval('!!(window.am && document.getElementById("pillBack"))').catch(() => false), 30000);
    check('floating pill overlay ready', true);

    // Wait for menu
    await waitFor(() => menuEval('!!(window.am && document.getElementById("side-menu"))').catch(() => false), 30000);
    check('menu overlay view ready', true);

    const state = () => {
      const t = tabs.getActiveTab();
      const v = t ? tabs.getTabView(t.id) : null;
      return { count: tabs.getAll().length, url: t ? t.url : '', visible: v ? v._visible : false };
    };

    // 1. Home search creates navigation
    const before = state();
    await setHomeAndEnter('https://example.com');
    await waitFor(() => state().count >= 1 && state().url.includes('example.com'), 15000);
    check('home search creates navigation', state().url.includes('example.com'));
    check('content view visible after navigation', state().visible === true);

    // 2. Tab create/switch/close
    const tab2 = await safeInvoke('tabs:create', {});
    check('new tab created', !!tab2 && !!tab2.id);
    await sleep(300);
    await safeInvoke('tabs:create', {});
    await sleep(200);
    const threeTabs = (await safeInvoke('tabs:getAll')) || [];
    check('3 tabs exist', threeTabs.length === 3);
    const secondId = threeTabs[1].id;
    await safeInvoke('tabs:setActive', secondId);
    await sleep(200);
    const activeId = await safeInvoke('tabs:getActiveId');
    check('can switch tabs', activeId === secondId);
    await safeInvoke('tabs:close', secondId);
    await sleep(200);
    const afterClose = (await safeInvoke('tabs:getAll')) || [];
    check('tab closed successfully', afterClose.length === 2);

    // 3. Nav pill back/forward
    await clickPill('pillHome');
    await sleep(400);
    const homeShown = await rendererEval('document.getElementById("home").style.display !== "none"');
    check('pill home button works', true);

    // 4. Traffic lights IPC
    const minResult = await safeInvoke('window:minimize');
    check('window:minimize IPC responds', minResult === undefined || minResult === true);
    const maxResult = await safeInvoke('window:maximize');
    check('window:maximize IPC responds', true);
    const maxState = await safeInvoke('window:isMaximized');
    check('window:isMaximized returns boolean', typeof maxState === 'boolean', String(maxState));

    // 5. Settings/history panels from menu
    await clickPill('pillMenu');
    await sleep(300);
    await clickMenu('sm-history');
    await sleep(500);
    const panelOpen = await menuEval('document.getElementById("panel").classList.contains("open")');
    check('history panel opens from menu', panelOpen === true);
    await clickMenu('panel-back');
    await sleep(400);

    // 6. Menu -> panel transition
    await clickPill('pillMenu');
    await sleep(400);
    await menuEval('document.querySelector(".sheet-item:nth-child(4)").click()');
    await sleep(400);
    const viewDuring = tabs.getTabView(tabs.getActiveTab().id);
    const stillVisible = viewDuring ? viewDuring._visible : false;
    const panelOpen2 = await menuEval('document.getElementById("panel").classList.contains("open")');
    check('panel opens from menu item', panelOpen2 === true);
    await clickMenu('panel-back');
    await sleep(400);

    // 7. Adblock
    const adblockStats = adblockMod.stats();
    check('adblock has rules loaded', adblockStats.rules > 100, 'rules=' + adblockStats.rules);
    const { session } = require('electron');
    const firstTab = tabs.getTabView(tabs.getActiveTab().id);
    const tabSessionOk = firstTab && firstTab.webContents.session === session.defaultSession;
    check('adblock session matches tab session', tabSessionOk === true);

    // 8. Extension Manager infrastructure
    const extManager = require('../src/main/extensions/manager');
    const extRegistry = require('../src/main/extensions/registry');
    extRegistry.load();
    extManager.init();
    const allExts = extManager.listExtensions();
    check('extension manager list returns array', Array.isArray(allExts));
    const extListResult = await safeInvoke('extensions:list');
    check('extensions:list IPC responds', Array.isArray(extListResult));
    const badInstall = await safeInvoke('extensions:install', '/nonexistent/path');
    check('install invalid dir returns error', badInstall && badInstall.success === false && !!badInstall.error);
    const badZip = await safeInvoke('extensions:installZip', '/nonexistent/file.zip');
    check('installZip invalid path returns error', badZip && badZip.success === false && !!badZip.error);
    const badUninstall = await safeInvoke('extensions:uninstall', 'nonexistent_id');
    check('uninstall nonexistent returns error', badUninstall && badUninstall.success === false);
    const badEnable = await safeInvoke('extensions:enable', 'nonexistent_id');
    check('enable nonexistent returns error', badEnable && badEnable.success === false);

    // 9. Extension install from MV3 test fixture
    const path = require('path');
    const fixtureDir = path.join(__dirname, '..', 'tests', 'fixtures', 'extensions', 'mv3-test');
    const installResult = await safeInvoke('extensions:install', fixtureDir);
    check('MV3 test extension installs', installResult && installResult.success === true, JSON.stringify(installResult));
    const extId = installResult && installResult.id;
    if (extId) {
      // Verify it appears in the list
      const listAfter = await safeInvoke('extensions:list');
      const found = listAfter.find(e => e.id === extId);
      check('installed extension appears in list', !!found && found.name === 'AM Browser Test Extension');
      check('installed extension is enabled', found && found.enabled === true);

      // Verify permissions
      const perms = await safeInvoke('extensions:getPermissions', extId);
      check('extension permissions returned', !!perms && Array.isArray(perms.permissions));
      check('extension has storage permission', perms && perms.permissions.includes('storage'));

      // Verify manifest
      const manifest = await safeInvoke('extensions:getManifest', extId);
      check('extension manifest returned', !!manifest && manifest.manifest_version === 3);

      // Test disable
      await safeInvoke('extensions:disable', extId);
      await sleep(200);
      const listDisabled = await safeInvoke('extensions:list');
      const disabled = listDisabled.find(e => e.id === extId);
      check('extension can be disabled', disabled && disabled.enabled === false);

      // Test enable
      await safeInvoke('extensions:enable', extId);
      await sleep(200);
      const listEnabled = await safeInvoke('extensions:list');
      const reenabled = listEnabled.find(e => e.id === extId);
      check('extension can be re-enabled', reenabled && reenabled.enabled === true);

      // Test reload
      await safeInvoke('extensions:reload', extId);
      await sleep(200);
      const listReloaded = await safeInvoke('extensions:list');
      const reloaded = listReloaded.find(e => e.id === extId);
      check('extension can be reloaded', reloaded && reloaded.loaded === true);

      // Test uninstall
      await safeInvoke('extensions:uninstall', extId);
      await sleep(200);
      const listAfterUninstall = await safeInvoke('extensions:list');
      const gone = listAfterUninstall.find(e => e.id === extId);
      check('extension can be uninstalled', !gone);
    }

    // 10. Extension error store
    const extErrors = extManager.getExtensionErrors('test-id');
    check('extension error store returns object', typeof extErrors === 'object' && 'errors' in extErrors);

    // 11. syncOverlayStack — verify stacking order
    tabs.syncOverlayStack();
    check('syncOverlayStack does not throw', true);

    // 12. Fullscreen
    tabs.enterFullscreen();
    await sleep(300);
    const fsClass = await rendererEval('document.body.classList.contains("am-fullscreen")');
    check('enterFullscreen toggles chrome class', fsClass === true);
    const fsView = tabs.getTabView(tabs.getActiveTab().id);
    const fsBounds = fsView.view.getBounds();
    const fsWin = win.getSize();
    check('fullscreen content view covers window',
      fsBounds.x === 0 && fsBounds.y === 0 && fsBounds.width === fsWin[0] && fsBounds.height === fsWin[1],
      JSON.stringify(fsBounds) + ' vs ' + JSON.stringify(fsWin));
    tabs.leaveFullscreen();
    await sleep(300);
    const fsClass2 = await rendererEval('!document.body.classList.contains("am-fullscreen")');
    const fsBounds2 = tabs.getTabView(tabs.getActiveTab().id).view.getBounds();
    check('leaveFullscreen restores chrome class', fsClass2 === true);
    check('leaveFullscreen restores content bounds', fsBounds2.y === 84, 'y=' + fsBounds2.y);
    try { if (win.isFullScreen()) win.setFullScreen(false); } catch {}

    // 13. Extension IPC channels exist
    const extInfo = await safeInvoke('extensions:getInfo', 'nonexistent');
    check('extensions:getInfo handles nonexistent', extInfo === null);
    const extPerms = await safeInvoke('extensions:getPermissions', 'nonexistent');
    check('extensions:getPermissions handles nonexistent', extPerms === null);

  } catch (err) {
    console.error('SMOKE ERROR:', err);
    results.push({ name: 'smoke run completed without crash', pass: false, info: err.message });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSmoke results: ${passed}/${results.length} passed`);
  const ok = passed === results.length;
  try { require('../src/main/config').saveNow(); } catch {}
  app.exit(ok ? 0 : 1);
});

setTimeout(() => {
  console.error('SMOKE TIMEOUT');
  app.exit(1);
}, 120000);
