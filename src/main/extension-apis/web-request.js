'use strict';

const { session } = require('electron');
const logger = require('../logger');

// Per-extension listener registry
// extensionId -> Map<"eventName:listenerId", { eventName, listenerId, callback }>
const listeners = new Map();

function extensionListeners(extId) {
  if (!listeners.has(extId)) listeners.set(extId, new Map());
  return listeners.get(extId);
}

// Convert Electron request details to Chrome-compatible format
function toChromeDetails(details) {
  return {
    requestId: String(details.id),
    url: details.url,
    method: details.method || 'GET',
    type: details.resourceType || 'other',
    tabId: details.webContentsId || -1,
    timestamp: Date.now() / 1000,
    frameId: details.frame || 0,
    parentFrameId: -1,
    initiator: details.referrer || '',
    origin: details.referrer || '',
  };
}

// Registered Electron handlers per event type
const electronHandlers = new Map();

function ensureElectronHandler(eventName) {
  if (electronHandlers.has(eventName)) return;

  const ses = session.defaultSession;
  if (!ses || !ses.webRequest) return;

  const filter = { urls: ['<all_urls>'] };

  const handlerMap = {
    onBeforeRequest: 'onBeforeRequest',
    onBeforeSendHeaders: 'onBeforeSendHeaders',
    onHeadersReceived: 'onHeadersReceived',
    onCompleted: 'onCompleted',
    onErrorOccurred: 'onErrorOccurred',
  };

  const electronMethod = handlerMap[eventName];
  if (!electronMethod) return;

  const electronCallback = (details, callback) => {
    const chromeDetails = toChromeDetails(details);
    let cancelled = false;
    let redirectUrl = '';

    // Notify all extension listeners
    for (const [, extMap] of listeners.entries()) {
      for (const [, entry] of extMap.entries()) {
        if (entry.eventName === eventName) {
          try {
            entry.callback({ ...chromeDetails, cancel: false }, (response) => {
              if (response && response.cancel) cancelled = true;
              if (response && response.redirectUrl) redirectUrl = response.redirectUrl;
            });
          } catch {}
        }
      }
    }

    // Electron's onBeforeRequest callback expects: callback({ cancel, redirectURL })
    if (electronMethod === 'onBeforeRequest' || electronMethod === 'onBeforeSendHeaders' || electronMethod === 'onHeadersReceived') {
      if (callback) {
        callback({ cancel: cancelled, redirectURL: redirectUrl || undefined });
      }
    } else if (callback) {
      callback({});
    }
  };

  try {
    if (electronMethod === 'onBeforeRequest' || electronMethod === 'onHeadersReceived') {
      ses.webRequest[electronMethod](filter, electronCallback);
    } else {
      ses.webRequest[electronMethod](filter, electronCallback);
    }
    electronHandlers.set(eventName, true);
  } catch (e) {
    logger.warn('extension-webrequest', `Failed to register ${eventName}`, { error: e.message });
  }
}

function addListener({ context, args }) {
  const [eventName, filter, extraInfoSpec] = args;

  if (typeof eventName !== 'string') throw new Error('eventName is required');

  const listenerId = `${context.extensionId}:${eventName}:${Date.now()}`;
  const map = extensionListeners(context.extensionId);

  // Create callback wrapper
  const callback = (details, sendResponse) => {
    // This is called by the Electron handler
    if (sendResponse) sendResponse({});
  };

  map.set(listenerId, { eventName, listenerId, callback });
  ensureElectronHandler(eventName);

  return { listenerId };
}

function removeListener({ context, args }) {
  const [eventName, listenerId] = args;
  const map = extensionListeners(context.extensionId);
  if (listenerId) {
    return map.delete(listenerId);
  }
  // Remove all listeners for this event
  let removed = 0;
  for (const [key, entry] of map.entries()) {
    if (entry.eventName === eventName) { map.delete(key); removed++; }
  }
  return removed > 0;
}

function hasListener({ context, args }) {
  const [eventName] = args;
  const map = extensionListeners(context.extensionId);
  for (const entry of map.values()) {
    if (entry.eventName === eventName) return true;
  }
  return false;
}

function destroyExtension(extensionId) {
  listeners.delete(extensionId);
}

module.exports = { addListener, removeListener, hasListener, destroyExtension };
