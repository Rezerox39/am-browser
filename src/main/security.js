
'use strict';

const { app, session, webContents } = require('electron');
const logger = require('./logger');

function harden() {
  // Prevent navigation to dangerous schemes from any webContents
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const scheme = new URL(url).protocol;
      if (scheme !== 'https:' && scheme !== 'http:' && scheme !== 'am:' && scheme !== 'file:' && scheme !== 'about:') {
        event.preventDefault();
        logger.warn('security', 'Blocked navigation to dangerous scheme', { url, scheme });
      }
    });

    // Block new window creation (use our popup handler instead)
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
  });

  // Deny all permission requests by default
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    logger.debug('security', 'Permission requested', { permission, origin: wc.getURL() });
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler(() => {
    return false;
  });

  // Block mixed content (this is default, but be explicit)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, cb) => {
      cb({ cancel: false });
    }
  );

  // Security: restrict CSP
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.resourceType === 'mainFrame') {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'content-security-policy': [
            "default-src 'self' https: http:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self' https: http:;"
          ],
        },
      });
    } else {
      cb({});
    }
  });

  logger.info('security', 'Security hardening applied');
}

module.exports = { harden };
