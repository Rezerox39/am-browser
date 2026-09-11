'use strict';

const { app, session } = require('electron');
const logger = require('./logger');

function harden() {
  // Block navigation to dangerous schemes only
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', (event, url) => {
      try {
        const scheme = new URL(url).protocol;
        if (scheme !== 'https:' && scheme !== 'http:' && scheme !== 'am:' &&
            scheme !== 'file:' && scheme !== 'about:' && scheme !== 'data:' &&
            scheme !== 'chrome-extension:' && scheme !== 'chrome:') {
          event.preventDefault();
          logger.warn('security', 'Blocked navigation to dangerous scheme', { url, scheme });
        }
      } catch {}
    });

    // Allow new windows/popups — tabs.js intercepts at WebContentsView level
    // and opens them as new tabs. Security.js only blocks truly dangerous schemes.
    contents.setWindowOpenHandler(({ url }) => {
      if (!url) return { action: 'deny' };
      try {
        const scheme = new URL(url).protocol;
        if (scheme === 'javascript:' || scheme === 'file:' || scheme === 'data:') {
          return { action: 'deny' };
        }
      } catch {}
      // Allow http/https (tabs.js will intercept and open as new tab)
      return { action: 'allow' };
    });
  });

  // Deny dangerous permission requests but allow common ones
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    // Allow common web permissions
    const allowed = [
      'media', 'geolocation', 'notifications', 'fullscreen',
      'clipboard-read', 'clipboard-sanitized-write',
      'mediaKeySystem', 'midi', 'midi-sysex',
      'pointerLock', 'idle-detection',
    ];
    if (allowed.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler(() => {
    return true;
  });

  logger.info('security', 'Security hardening applied');
}

module.exports = { harden };
