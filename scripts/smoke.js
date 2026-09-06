'use strict';

/**
 * Headless smoke test for AM. Exercises the exact user flows that previously
 * regressed: home search -> page view, tab create/switch/close, nav pill,
 * traffic-light IPC, and slide-in panel insets.
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

app.whenReady().then(async () => {
  try {
    const config = require('../src/main/config');
    const windowManager = require('../src/main/window');
    const ipcHandler = require('../src/main/ipc');
    tabs = require('../src/main/tabs');

    config.load();

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

    // 1b. Content view must be FULL-BLEED to the bottom (no black strip
    // reserved for the pill — the pill floats OVER the page instead).
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

    // 6. Pill menu opens the chrome side menu; the content view shrinks (inset)
    // so the panel is clickable; closing the menu restores the view AND the
    // pill survives with the same bounds (pill-destruction regression test)
    await clickPill('pillMenu');
    await sleep(400);
    const menuOpen = await rendererEval('document.querySelector("#side-menu").classList.contains("open")');
    const view = tabs.getTabView(tabs.getActiveTab().id);
    const bounds = view ? view.view.getBounds() : null;
    const winSize = win.getSize();
    check('pill menu opens side menu', menuOpen === true);
    check('menu inset shrinks view', bounds && bounds.width === winSize[0] - 340, `viewW=${bounds ? bounds.width : '?'} winW=${winSize[0]}`);
    await clickSel('#menu-close-btn');
    await sleep(400);
    const bounds2 = tabs.getTabView(tabs.getActiveTab().id).view.getBounds();
    check('closing menu restores view width', bounds2.width >= winSize[0] - 2, `viewW=${bounds2.width}`);
    const pillBoundsAfter = tabs.getPillView() ? tabs.getPillView().getBounds() : null;
    check('pill survives menu open/close',
      pillBoundsAfter && pillBoundsAfter.x === pillBounds.x && pillBoundsAfter.y === pillBounds.y,
      JSON.stringify(pillBoundsAfter));
    // Pill still interactive after the cycle
    await clickPill('pillMenu');
    await sleep(400);
    const menuOpen2 = await rendererEval('document.querySelector("#side-menu").classList.contains("open")');
    check('pill clickable after menu cycle', menuOpen2 === true);
    await clickSel('#menu-close-btn');
    await sleep(300);

    // 6b. ui:esc IPC closes the menu — this is the handler that real OS Escape
    // key reaches via main-process before-input-event -> forwardGlobalKey.
    // sendInputEvent doesn't trigger before-input-event in headless Electron,
    // so we test the renderer handler directly via webContents.send.
    await clickPill('pillMenu');
    await sleep(400);
    await win.webContents.send('ui:esc');
    await sleep(400);
    const escapedFromIpc = await rendererEval('document.querySelector("#side-menu").classList.contains("open")');
    const escBounds = tabs.getTabView(tabs.getActiveTab().id).view.getBounds();
    check('ui:esc IPC closes menu', escapedFromIpc === false);
    check('ui:esc restores view width', escBounds.width >= winSize[0] - 2, `viewW=${escBounds.width}`);

    // 6d. Pill menu button toggles (clicking menu button when already open closes)
    await clickPill('pillMenu');
    await sleep(400);
    const open3 = await rendererEval('document.querySelector("#side-menu").classList.contains("open")');
    await clickPill('pillMenu');
    await sleep(400);
    const closed3 = await rendererEval('document.querySelector("#side-menu").classList.contains("open")');
    check('pill menu opens on first click', open3 === true);
    check('pill menu toggles closed on second click', closed3 === false);

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

    // 8. Settings/history panels load (inset + panel body rendered)
    await clickSel('#navMenu');
    await sleep(300);
    await clickSel('#menu-history');
    await sleep(500);
    const panelOpen = await rendererEval('document.querySelector("#panel").classList.contains("open")');
    check('history panel opens from menu', panelOpen === true);
    await rendererEval('document.querySelector("#panel-back").dispatchEvent(new MouseEvent("click", {bubbles:true}))');
    await sleep(300);

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
