'use strict';
const { app } = require('electron');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');

const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let server, port;
function startServer() { return new Promise(res => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, {'Content-Type':'text/html'});
      res.end('<html><head><title>My Test Website</title></head><body><h1>Hello</h1></body></html>');
    } else { res.writeHead(404); res.end(); }
  });
  server.listen(0,'127.0.0.1', ()=>{port=server.address().port; res();});
})}

let win, tabs;
app.whenReady().then(async () => {
  try {
    const config = require('../src/main/config');
    const windowManager = require('../src/main/window');
    const ipcHandler = require('../src/main/ipc');
    tabs = require('../src/main/tabs');
    config.load();
    await startServer();
    win = windowManager.create();
    ipcHandler.register(win);
    tabs.init({window: win, url: ''});

    const testUrl = `http://127.0.0.1:${port}/page`;
    const tab = tabs.create({url: testUrl});
    tabs.setActive(tab.id);

    // Listen to raw webContents events on the tab's view
    const view = tabs.getTabView(tab.id);
    const wc = view.webContents;

    wc.on('page-title-updated', (e, title) => {
      console.log('[DEBUG] page-title-updated fired:', title);
    });
    wc.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
      console.log('[DEBUG] did-start-navigation fired:', url, 'isMainFrame:', isMainFrame);
    });
    wc.on('did-navigate', (e, url) => {
      console.log('[DEBUG] did-navigate fired:', url);
    });

    await sleep(3000);
    const rec = tabs.getRecord(tab.id);
    console.log('[DEBUG] Final record title:', JSON.stringify(rec.title));
    console.log('[DEBUG] Final record url:', JSON.stringify(rec.url));

    server.close();
    app.exit(0);
  } catch(e) { console.error('ERROR:', e); try{server&&server.close()}catch{}; app.exit(1); }
});
