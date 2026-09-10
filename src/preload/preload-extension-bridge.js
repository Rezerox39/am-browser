'use strict';
/**
 * Extension API Bridge Preload
 * Injected into chrome-extension:// contexts to provide missing Chrome APIs.
 * Does NOT overwrite APIs supplied by electron-chrome-extensions.
 */
const { contextBridge, ipcRenderer } = require('electron');

if (!location.href.startsWith('chrome-extension://')) return;

const CHANNEL = 'am-ext-api';

async function call(api, method, args = []) {
  return ipcRenderer.invoke(CHANNEL, { api, method, args });
}

function callbackify(promise, callback) {
  if (typeof callback !== 'function') return promise;
  promise.then(result => callback(result), error => callback(undefined, error));
  return undefined;
}

function createStorageArea(area) {
  return {
    get(keys, callback) { return callbackify(call('storage', 'get', [area, keys]), callback); },
    set(items, callback) { return callbackify(call('storage', 'set', [area, items]), callback); },
    remove(keys, callback) { return callbackify(call('storage', 'remove', [area, keys]), callback); },
    clear(callback) { return callbackify(call('storage', 'clear', [area]), callback); },
    getBytesInUse(keys, callback) { return callbackify(call('storage', 'getBytesInUse', [area, keys]), callback); },
  };
}

function createAlarms() {
  const listeners = new Set();
  return {
    create(name, alarmInfo, callback) {
      const p = call('alarms', 'create', [name, alarmInfo || {}]);
      if (callback) return callbackify(p, callback);
      return p;
    },
    get(name, callback) { return callbackify(call('alarms', 'get', [name]), callback); },
    getAll(callback) { return callbackify(call('alarms', 'getAll', []), callback); },
    clear(name, callback) { return callbackify(call('alarms', 'clear', [name]), callback); },
    clearAll(callback) { return callbackify(call('alarms', 'clearAll', []), callback); },
    onAlarm: {
      addListener(fn) { if (typeof fn === 'function') listeners.add(fn); },
      removeListener(fn) { listeners.delete(fn); },
      hasListener(fn) { return listeners.has(fn); },
    },
    __dispatch(alarm) { for (const fn of listeners) { try { fn(alarm); } catch {} } },
  };
}

function createWebRequest() {
  function makeEvent(name) {
    return {
      addListener(fn, filter, extraInfoSpec) {
        call('webRequest', 'addListener', [name, filter || {}, extraInfoSpec || []]);
        listeners_map.set(name, fn);
      },
      removeListener(fn) {
        call('webRequest', 'removeListener', [name]);
        listeners_map.delete(name);
      },
      hasListener(fn) { return listeners_map.has(name); },
    };
  }
  return {
    onBeforeRequest: makeEvent('onBeforeRequest'),
    onBeforeSendHeaders: makeEvent('onBeforeSendHeaders'),
    onHeadersReceived: makeEvent('onHeadersReceived'),
    onCompleted: makeEvent('onCompleted'),
    onErrorOccurred: makeEvent('onErrorOccurred'),
  };
}

const listeners_map = new Map();

async function install() {
  const caps = await call('getCapabilities', 'get', []);
  const chrome = globalThis.chrome || {};

  // chrome.storage
  if (!chrome.storage) chrome.storage = {};
  if (caps.storage?.local && !chrome.storage.local) chrome.storage.local = createStorageArea('local');
  if (caps.storage?.sync && !chrome.storage.sync) chrome.storage.sync = createStorageArea('sync');
  if (caps.storage?.session && !chrome.storage.session) chrome.storage.session = createStorageArea('session');

  // chrome.alarms
  if (caps.alarms && !chrome.alarms) chrome.alarms = createAlarms();

  // chrome.scripting
  if (!chrome.scripting && caps.scripting) {
    chrome.scripting = {
      executeScript(details, callback) { return callbackify(call('scripting', 'executeScript', [details]), callback); },
      insertCSS(details, callback) { return callbackify(call('scripting', 'insertCSS', [details]), callback); },
    };
  }

  // chrome.notifications
  if (!chrome.notifications && caps.notifications) {
    chrome.notifications = {
      create(options, callback) { return callbackify(call('notifications', 'create', [options]), callback); },
      update(id, options, callback) { return callbackify(call('notifications', 'update', [id, options]), callback); },
      clear(id, callback) { return callbackify(call('notifications', 'clear', [id]), callback); },
      getAll(callback) { return callbackify(call('notifications', 'getAll', []), callback); },
      onClicked: { addListener() {}, removeListener() {}, hasListener() { return false; } },
      onClosed: { addListener() {}, removeListener() {}, hasListener() { return false; } },
    };
  }

  // chrome.cookies
  if (!chrome.cookies && caps.cookies) {
    chrome.cookies = {
      get(details, callback) { return callbackify(call('cookies', 'get', [details]), callback); },
      getAll(details, callback) { return callbackify(call('cookies', 'getAll', [details || {}]), callback); },
      set(details, callback) { return callbackify(call('cookies', 'set', [details]), callback); },
      remove(details, callback) { return callbackify(call('cookies', 'remove', [details]), callback); },
      getAllCookieStores(callback) { return callbackify(call('cookies', 'getAllCookieStores', []), callback); },
      onChanged: { addListener() {}, removeListener() {}, hasListener() { return false; } },
    };
  }

  // chrome.webRequest
  if (caps.webRequest && !chrome.webRequest) {
    chrome.webRequest = createWebRequest();
  }

  // Listen for events from main process
  ipcRenderer.on('am-ext-event', (event, eventName, detail) => {
    if (eventName === 'alarms.onAlarm' && chrome.alarms?.__dispatch) {
      chrome.alarms.__dispatch(detail);
    }
  });

  globalThis.chrome = chrome;
}

install().catch(error => {
  console.error('Extension API bridge install failed:', error);
});
