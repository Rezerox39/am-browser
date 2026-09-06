'use strict';

const { app, session } = require('electron');
const logger = require('./logger');

function harden() {
  // Prevent navigation to dangerous schemes from any webContents
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, url) => {
      try {
        const scheme = new URL(url).protocol;
        if (scheme !== 'https:' && scheme !== 'http:' && scheme !== 'am:' && scheme !== 'file:' && scheme !== 'about:' && scheme !== 'data:' && scheme !== 'chrome-extension:' && scheme !== 'chrome:') {
          event.preventDefault();
          logger.warn('security', 'Blocked navigation to dangerous scheme', { url, scheme });
        }
      } catch {}
    });

    // Block new window creation
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
  });

  // Deny all permission requests by default
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler(() => {
    return false;
  });

  // Do NOT inject CSP — let sites manage their own CSP
  // The previous restrictive CSP broke most modern websites

  logger.info('security', 'Security hardening applied');
}

module.exports = { harden };
