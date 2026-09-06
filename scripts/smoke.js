'use strict';

/**
 * Headless smoke test for AM. Exercises the exact user flows that previously
 * regressed: home search -> page view, tab create/switch/close, nav pill,
 * traffic-light IPC, and the WebContentsView slide-in menu overlay.
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

async function clickSel(sel) {
  return rendererEval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
}

// The floating nav pill is a separate transparent overlay view (topmost),
// so tests drive its buttons through its own webContents.
function pillEval(js) {
  const pill = tabs.getPillView();
  if (!pill || !pill.webContents || pill.webContents.isDestroyed()) {
    return Promise.resolve(false);
  }
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

// The slide-in menu/panel is a separate WebContentsView overlay (menu.html).
// Tests drive its buttons through its own webContents.
function menuEval(js) {
  const mv = tabs.getMenuView ? tabs.getMenuView() : null;
  if (!mv || !mv.webContents || mv.webContents.isDestroyed()) {
    return Promise.resolve(false);
  }
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

    // Wait for the chrome renderer to be alive and the preload bridge present
    await waitFor(() =>
      rendererEval('!!(window.am && document.getElementById("home-input"))').catch(() => false), 30000);
    check('chrome renderer ready (preload bridge + home input)', true);

    // Wait for the floating pill overlay view to load
    await waitFor(() => pillEval('!!(window.am && document.getElementById("pillBack"))').catch(() => false), 30000);
    check('floating pill overlay ready', true);

    // Wait for the menu overlay view to load
    await waitFor(() => menuEval('!!(window.am && document.getElementById("side-menu"))').catch(() => false), 30000);
    check('menu overlay view ready', true);

    const state = () => {
      const t = tabs.getActiveTab();
      const v = t ? tabs.getTabView(t.id) : null;
      return {
        count: tabs.getAll().length,
        url: t ? t.url : '',
        visible: v ? v._visible : false,
      };
    };

    // 1. Home search must create a navigation and SHOW the web view
    await setHomeAndEnter('youtube');
    await waitFor(() => state().url.includes('google.com/search?q=youtube'), 15000).catch(() => {});
    const s1 = state();
    check('home search set active tab url', s1.url.includes('google.com/search?q=youtube'), s1.url || '(empty)');
    check('web view visible after search', s1.visible === true);

    // 1b. Content view must be FULL-BLEED to the bottom
    const fullView = tabs.getTabView(tabs.getActiveTab().id);
    const fullBounds = fullView ? fullView.view.getBounds() : null;
    const winSize0 = win.getSize();
    check('content view is full-bleed (no bottom reserve)',
      fullBounds && fullBounds.x === 0 && fullBounds.width >= winSize0[0] - 2 &&
      fullBounds.height >= winSize0[1] - 84 - 2,
      JSON.stringify(fullBounds));

    // 1c. Pill overlay sits centered at the bottom, floating above content
    const pillBounds = tabs.getPillView() ? tabs.getPillView().getBounds() : null;
    const PILL = tabs.PILL;
    check('pill overlay floats at bottom center',
      pillBounds && Math.abs(pillBounds.x - Math.round((winSize0[0] - PILL.width) / 2)) <= 2 &&
      Math.abs(pillBounds.y - (winSize0[1] - PILL.height - PILL.bottom)) <= 2,
      JSON.stringify(pillBounds));

    // 1d. No navigation history yet -> pill back/forward are disabled
    const bfDisabled = await pillEval('document.getElementById("pillBack").classList.contains("disabled") && document.getElementById("pillForward").classList.contains("disabled")');
    check('pill back/forward disabled with no history', bfDisabled === true);

    // 2. Pill Home button must hide the view so the home screen is clickable
    await clickPill('pillHome');
    await sleep(400);
    const s2 = state();
    check('pill home hides web view', s2.visible === false);
    const homeShown = await rendererEval('!(document.getElementById("home").classList.contains("hidden"))');
    check('home screen visible after pill home', homeShown === true);

    // 2b. Clicking on the home screen must refocus the search input
    await rendererEval('document.getElementById("home").dispatchEvent(new MouseEvent("click", { bubbles: true }))');
    await sleep(150);
    const refocused = await rendererEval('document.activeElement && document.activeElement.id === "home-input"');
    check('home click refocuses search input', refocused === true);

    // 3. Pill new-tab button creates a tab (blank -> view hidden) and the
    // badge updates
    const countBefore = state().count;
    await clickPill('pillTabs');
    await sleep(400);
    const s3 = state();
    check('pill tabs creates a tab', s3.count === countBefore + 1, `count=${s3.count}`);
    check('new blank tab keeps view hidden', s3.visible === false);
    const badge = await pillEval('document.getElementById("pillTabCount").textContent');
    check('pill tab badge updated', badge === String(s3.count), `badge=${badge}`);

    // 4. Clicking a tab chip switches to it and shows its view
    const chipCount = await rendererEval('document.querySelectorAll(".tab-chip").length');
    await clickSel('.tab-chip');
    await sleep(400);
    const s4 = state();
    check('tab chip exists and switches', chipCount >= 2 && s4.visible === true, `chips=${chipCount}`);

    // 5. Close button on the active tab chip removes it
    const countMid = state().count;
    await clickSel('.tab-chip.active .tc-close');
    await sleep(400);
    const s5 = state();
    check('tab chip close removes a tab', s5.count === countMid - 1, `count=${s5.count}`);

    // 6. Navigate to a page so the content view is visible, then test menu
    // overlay hide/show. The menu is a separate WebContentsView that slides
    // over the window (content is hidden behind it).
    await setHomeAndEnter('example');
    await sleep(1200);
    await clickPill('pillMenu');
    await sleep(400);
    const menuOpen = tabs.isMenuOpen();
    const view = tabs.getTabView(tabs.getActiveTab().id);
    const contentVisible = view ? view._visible : false;
    const winSize = win.getSize();
    check('pill menu opens side menu', menuOpen === true);
    check('menu overlays without hiding content', contentVisible === true, `visible=${contentVisible}`);

    // Verify floating geometry: menu has non-zero top/right/bottom margins (not edge-attached)
    const menuBounds = tabs.getMenuView().getBounds();
    const topMargin = menuBounds.y;
    const rightMargin = winSize[0] - (menuBounds.x + menuBounds.width);
    const bottomMargin = winSize[1] - (menuBounds.y + menuBounds.height);
    check('menu has top margin (>0)', topMargin > 0, `top=${topMargin}`);
    check('menu has right margin (>0)', rightMargin > 0, `right=${rightMargin}`);
    check('menu has bottom margin (>0)', bottomMargin > 0, `bottom=${bottomMargin}`);

    // Close via menu's own close button (in the menu overlay view)
    await clickMenu('menu-close-btn');
    await sleep(400);
    const contentVisibleAfter = tabs.getTabView(tabs.getActiveTab().id)._visible;
    check('content still visible after menu closes', contentVisibleAfter === true);
    const pillBoundsAfter = tabs.getPillView() ? tabs.getPillView().getBounds() : null;
    check('pill survives menu open/close',
      pillBoundsAfter && pillBoundsAfter.x === pillBounds.x && pillBoundsAfter.y === pillBounds.y,
      JSON.stringify(pillBoundsAfter));

    // Pill still interactive after the cycle
    await clickPill('pillMenu');
    await sleep(400);
    const menuOpen2 = tabs.isMenuOpen();
    check('pill clickable after menu cycle', menuOpen2 === true);
    await clickMenu('menu-close-btn');
    await sleep(300);

    // 6b. Escape key closes the menu — simulates real OS Escape via
    // before-input-event on the active content view.
    await clickPill('pillMenu');
    await sleep(400);
    // Simulate real Escape key press via before-input-event
    const escView = tabs.getTabView(tabs.getActiveTab().id);
    if (escView && escView.webContents && !escView.webContents.isDestroyed()) {
      escView.webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape', code: 'Escape' });
    }
    await sleep(400);
    const escapedFromIpc = !tabs.isMenuOpen();
    const escContentVisible = tabs.getTabView(tabs.getActiveTab().id)._visible;
    check('escape key closes menu', escapedFromIpc === true);
    check('content stays visible through escape', escContentVisible === true);

    // 6d. Pill menu button toggles (clicking menu button when already open closes)
    await clickPill('pillMenu');
    await sleep(400);
    const open3 = tabs.isMenuOpen();
    await clickPill('pillMenu');
    await sleep(400);
    const closed3 = !tabs.isMenuOpen();
    check('pill menu opens on first click', open3 === true);
    check('pill menu toggles closed on second click', closed3 === true);

    // 6e. Close a tab without crashing (destroy-safety regression test)
    await clickPill('pillTabs');
    await sleep(300);
    const cntBefore = state().count;
    await clickSel('.tab-chip.active .tc-close');
    await sleep(400);
    const cntAfter = state().count;
    check('close tab did not crash', true);
    check('tab count decreased after close', cntAfter === cntBefore - 1, `before=${cntBefore} after=${cntAfter}`);

    // 7. Traffic-light IPC handlers are registered
    const maxState = await rendererEval('window.am.invoke("window:isMaximized")').catch(() => null);
    check('window:isMaximized IPC responds', typeof maxState === 'boolean', String(maxState));

    // 8. Settings/history panels load (in the menu overlay view)
    await clickPill('pillMenu');
    await sleep(300);
    await clickMenu('sm-history');
    await sleep(500);
    const panelOpen = await menuEval('document.getElementById("panel").classList.contains("open")');
    check('history panel opens from menu', panelOpen === true);
    await clickMenu('panel-back');
    await sleep(400);

    // 9. Menu -> panel: content stays hidden through the transition
    await clickPill('pillMenu');
    await sleep(400);
    await menuEval('document.querySelector(".sheet-item:nth-child(2)").click()'); // Bookmarks
    await sleep(400);
    const viewDuring = tabs.getTabView(tabs.getActiveTab().id);
    const stillHidden = viewDuring ? viewDuring._visible : false;
    const panelOpen2 = await menuEval('document.getElementById("panel").classList.contains("open")');
    const sideMenuHidden = await menuEval('!document.getElementById("side-menu").classList.contains("open")');
    check('content stays visible during menu->panel', stillHidden === true);
    check('panel open after menu->panel nav', panelOpen2 === true);
    check('side menu hidden after panel opens', sideMenuHidden === true);
    await clickMenu('panel-back');
    await sleep(400);

    // 10. Adblock: verify engine is wired to the correct session
    const adblockStats = adblockMod.stats();
    check('adblock has rules loaded', adblockStats.rules > 100, `rules=${adblockStats.rules}`);
    const defSession = (await import('electron')).session.defaultSession;
    const firstTab = tabs.getTabView(tabs.getActiveTab().id);
    const tabSessionOk = firstTab && firstTab.webContents.session === defSession;
    check('adblock session matches tab session', tabSessionOk === true);
    const amProtocol = await rendererEval('window.location.href').catch(() => '');
    // 11. Fullscreen class + bounds: entering HTML fullscreen covers the window
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
    check('leaveFullscreen restores content bounds', fsBounds2.y === 84, `y=${fsBounds2.y}`);
    try { if (win.isFullScreen()) win.setFullScreen(false) } catch {}

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
}, 90000);
