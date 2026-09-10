'use strict';
/**
 * Verifies tab title updates work end-to-end: create tab -> navigate to page
 * with <title> -> tab record shows page title.
 */
const { app } = require('electron');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('no-sandbox');

const http = require('http');
const results = [];
function check(name, cond, info) { results.push({name, pass: !!cond, info: info||''}); console.log((cond?'  PASS ':'  FAIL ')+name+(info?' — '+info:'')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout=20000, interval=150) { const s=Date.now(); for(;;){ try{const v=await fn(); if(v) return v;}catch{} if(Date.now()-s>timeout) throw new Error('waitFor timeout'); await sleep(interval);} }

let server, port;
function startServer() { return new Promise(res => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, {'Content-Type':'text/html'});
      res.end('<html><head><title>My Test Website</title></head><body><h1>Hello World</h1></body></html>');
    } else { res.writeHead(404); res.end('nf'); }
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
    await sleep(3000);
    const rec = tabs.getRecord(tab.id);
    check('tab record URL set', !!rec.url, rec.url);
    check('tab title is page title (was hostname fallback)', rec.title === 'My Test Website', rec.title);

    // Get the tab info sent to renderer
    const all = tabs.getAll();
    const t = all.find(x => x.id === tab.id);
    check('tab info title', t && t.title === 'My Test Website', t && t.title);

    server.close();
    const failed = results.filter(r=>!r.pass).length;
    console.log(`\nTitle test results: ${results.length-failed}/${results.length} passed`);
    app.exit(failed?1:0);
  } catch(e) { console.error('TITLE TEST ERROR:', e); try{server&&server.close()}catch{}; app.exit(1); }
});
