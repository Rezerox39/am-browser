'use strict';

const { ipcMain, webContents } = require('electron');
const logger = require('../logger');

const storage = require('./storage');
const scripting = require('./scripting');
const alarms = require('./alarms');
const notifications = require('./notifications');
const cookies = require('./cookies');
const webRequest = require('./web-request');

const handlers = {
  storage,
  scripting,
  alarms,
  notifications,
  cookies,
  webRequest,
};

const capabilities = {
  storage: { local: true, sync: true, session: true },
  scripting: { executeScript: true, insertCSS: true },
  alarms: true,
  notifications: true,
  cookies: true,
  webRequest: true,
};

// WebContents ID -> extension context mapping
const contextMap = new Map();
let bridgeInstance = null;

function makeError(message, code = 'EXTENSION_API_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    throw makeError('Invalid bridge request', 'INVALID_REQUEST');
  }
  if (typeof request.api !== 'string' || typeof request.method !== 'string') {
    throw makeError('Invalid API request', 'INVALID_REQUEST');
  }
  if (request.api !== 'getCapabilities' && !Object.prototype.hasOwnProperty.call(handlers, request.api)) {
    throw makeError(`Unsupported API: ${request.api}`, 'UNSUPPORTED_API');
  }
}

/**
 * Derive extension identity from a WebContents.
 * Never trust renderer-provided extension IDs.
 */
function getExtensionContext(sender) {
  if (!sender || sender.isDestroyed()) return null;

  // Check the context map first
  const mapped = contextMap.get(sender.id);
  if (mapped) return mapped;

  // Derive from URL
  try {
    const url = sender.getURL();
    const match = url.match(/^chrome-extension:\/\/([a-z0-9]+)/i);
    if (match) {
      const extensionId = match[1];
      // Look up the extension in the session
      const ses = sender.session;
      if (ses && typeof ses.getAllExtensions === 'function') {
        const ext = ses.getAllExtensions().find(e => e.id === extensionId);
        if (ext) {
          return buildContext(sender, ext);
        }
      }
      // Fallback: create minimal context
      return buildContext(sender, { id: extensionId, name: extensionId, path: '' });
    }
  } catch {}

  return null;
}

function buildContext(sender, extension) {
  return {
    extensionId: extension.id,
    extensionName: extension.name || extension.id,
    extensionPath: extension.path || '',
    webContents: sender,
    session: sender.session,
    dispatchEvent(eventName, detail) {
      try {
        if (!sender.isDestroyed()) {
          sender.send(`am-ext-event`, eventName, detail);
        }
      } catch {}
    },
  };
}

function registerExtension(extension, extWebContents) {
  const ctx = buildContext(extWebContents, extension);
  contextMap.set(extWebContents.id, ctx);
  logger.info('extension-bridge', `Registered context: ${extension.name || extension.id}`);
  return ctx;
}

function unregisterExtension(extensionId) {
  // Find and remove all contexts for this extension
  for (const [wcId, ctx] of contextMap.entries()) {
    if (ctx.extensionId === extensionId) {
      contextMap.delete(wcId);
    }
  }
  // Clean up all API state
  for (const api of Object.values(handlers)) {
    if (typeof api.destroyExtension === 'function') {
      api.destroyExtension(extensionId);
    }
  }
  logger.info('extension-bridge', `Unregistered extension: ${extensionId}`);
}

function init() {
  if (bridgeInstance) return bridgeInstance;

  ipcMain.handle('am-ext-api', async (event, request) => {
    validateRequest(request);

    const context = getExtensionContext(event.sender);
    if (!context) {
      throw makeError('Unknown extension context', 'UNKNOWN_EXTENSION');
    }

    if (request.api === 'getCapabilities') {
      return capabilities;
    }

    const api = handlers[request.api];
    if (!api) throw makeError(`Unsupported API: ${request.api}`, 'UNSUPPORTED_API');

    const method = api[request.method];
    if (typeof method !== 'function') {
      throw makeError(`Unsupported method: ${request.api}.${request.method}`, 'UNSUPPORTED_METHOD');
    }

    return method({ context, args: Array.isArray(request.args) ? request.args : [] });
  });

  bridgeInstance = {
    capabilities,
    registerExtension,
    unregisterExtension,
    destroyExtension: unregisterExtension,
  };

  logger.info('extension-bridge', 'IPC dispatcher registered');
  return bridgeInstance;
}

module.exports = { init, capabilities, registerExtension, unregisterExtension, getExtensionContext };
