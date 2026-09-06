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

app.whenReady().then(async () => {
  try {
    const config = require('../src/main/config');
    const windowManager = require('../src/main/window');
    const ipcHandler = require('../src/main/ipc');
    const tabs = require('../src/main/tabs');

    config.load();

    win = windowManager.create();
    ipcHandler.register(win);
    tabs.init({ window: win, url: '' });

    // Wait for the chrome renderer to be alive and the preload bridge present
    await waitFor(() =>
      rendererEval('!!(window.am && document.getElementById("home-input"))').catch(() => false), 30000);
    check('chrome renderer ready (preload bridge + home input)', true);

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

    // 2. Home button must hide the view so the home screen is clickable
    await clickSel('#navHome');
    await sleep(400);
    const s2 = state();
    check('navHome hides web view', s2.visible === false);
    const homeShown = await rendererEval('!(document.getElementById("home").classList.contains("hidden"))');
    check('home screen visible after navHome', homeShown === true);

    // 2b. Clicking on the home screen must refocus the search input
    await rendererEval('document.getElementById("home").dispatchEvent(new MouseEvent("click", { bubbles: true }))');
    await sleep(150);
    const refocused = await rendererEval('document.activeElement && document.activeElement.id === "home-input"');
    check('home click refocuses search input', refocused === true);

    // 3. New-tab button creates a tab (blank -> view hidden)
    const countBefore = state().count;
    await clickSel('#navTabs');
    await sleep(400);
    const s3 = state();
    check('navTabs creates a tab', s3.count === countBefore + 1, `count=${s3.count}`);
    check('new blank tab keeps view hidden', s3.visible === false);

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

    // 6. Bottom-nav menu opens; view shrinks (inset) so the panel is clickable
    await clickSel('#navMenu');
    await sleep(400);
    const menuOpen = await rendererEval('document.querySelector("#side-menu").classList.contains("open")');
    const view = tabs.getTabView(tabs.getActiveTab().id);
    const bounds = view ? view.view.getBounds() : null;
    const winSize = win.getSize();
    check('navMenu opens side menu', menuOpen === true);
    check('menu inset shrinks view', bounds && bounds.width < winSize[0] - 40, `viewW=${bounds ? bounds.width : '?'} winW=${winSize[0]}`);
    await clickSel('#menu-close-btn');
    await sleep(400);
    const bounds2 = tabs.getTabView(tabs.getActiveTab().id).view.getBounds();
    check('closing menu restores view width', bounds2.width >= winSize[0] - 40, `viewW=${bounds2.width}`);

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
