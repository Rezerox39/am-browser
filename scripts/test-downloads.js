'use strict';

/**
 * End-to-end download test.
 */
const { app } = require('electron');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');

const http = require('http');
const path = require('path');
const fs = require('fs');

const results = [];
function check(name, cond, info) {
  results.push({ name, pass: !!cond, info: info || '' });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (info ? ' — ' + info : ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 20000, interval = 150) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await sleep(interval);
  }
}

const TEST_CONTENT = Buffer.alloc(256 * 1024, 0x41);
let server, serverPort;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><p>Test page</p></body></html>');
      } else if (req.url === '/file.bin') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="test-download.bin"',
          'Content-Length': TEST_CONTENT.length,
        });
        res.end(TEST_CONTENT);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

let win, tabs, downloads;

app.whenReady().then(async () => {
  try {
    const config = require('../src/main/config');
    const windowManager = require('../src/main/window');
    const ipcHandler = require('../src/main/ipc');
    tabs = require('../src/main/tabs');

    config.load();
    config.set('askWhereToSave', false);
    config.set('adblock', { enabled: false, customRules: [] });

    await startServer();
    check('local http server started', serverPort > 0, `port=${serverPort}`);

    win = windowManager.create();
    downloads = require('../src/main/downloads');
    downloads.init();
    downloads.setWindow(win);
    ipcHandler.register(win);
    tabs.init({ window: win, url: '' });

    // Navigate to test page
    const testUrl = `http://127.0.0.1:${serverPort}/page`;
    const tab = tabs.create({ url: testUrl });
    tabs.setActive(tab.id);
    await sleep(1500);
    check('navigated to test page', tabs.getActiveTab().url.includes('/page'));

    // Trigger download via Electron's session API directly
    // This simulates what happens when a server sends Content-Disposition: attachment
    const view = tabs.getTabView(tab.id);
    const fileUrl = `http://127.0.0.1:${serverPort}/file.bin`;

    // Use session.downloadURL which properly triggers will-download
    view.webContents.downloadURL(fileUrl);
    console.log('[DL-TEST] downloadURL called:', fileUrl);
    await sleep(500);

    // Verify download record created
    const items1 = downloads.getAll();
    console.log('[DL-TEST] downloads.getAll():', items1.length, 'items');
    check('download record created', items1.length >= 1, `items=${items1.length}`);
    if (items1.length > 0) {
      check('download filename correct', items1[0].filename === 'test-download.bin', items1[0].filename);
      check('download state progressing', items1[0].state === 'progressing', items1[0].state);
    }

    // Wait for completion
    await waitFor(() => {
      const all = downloads.getAll();
      return all.some(i => i.state === 'complete');
    }, 15000);

    const done = downloads.getAll()[0];
    check('download completed', done.state === 'complete', done.state);
    check('received = total bytes', done.receivedBytes === done.totalBytes, `${done.receivedBytes}/${done.totalBytes}`);
    check('total = 256KB', done.totalBytes === TEST_CONTENT.length, `total=${done.totalBytes}`);

    // Verify file exists on disk
    const dlDir = path.join(app.getPath('home'), 'Downloads');
    const filePath = path.join(dlDir, 'test-download.bin');
    const fileExists = fs.existsSync(filePath);
    check('file exists in Downloads', fileExists, filePath);
    if (fileExists) {
      const size = fs.statSync(filePath).size;
      check('file size matches', size === TEST_CONTENT.length, `${size} bytes`);
      fs.unlinkSync(filePath);
    }

    // Verify menu view receives broadcasts
    const menuView = tabs.getMenuView();
    check('menu view exists', !!menuView);

    // Clean up
    server.close();
    app.quit();
  } catch (e) {
    console.error('DOWNLOAD TEST ERROR:', e);
    try { server && server.close(); } catch {}
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\nDownload test results: ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
});
