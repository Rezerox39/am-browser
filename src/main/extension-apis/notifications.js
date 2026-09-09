'use strict';

const { Notification } = require('electron');
const logger = require('../logger');

function handleNotificationCreate(args) {
  const { id, title, message, type, iconUrl, priority } = args || {};
  if (!title || !message) return Promise.reject(new Error('title and message required'));

  const notifOptions = {
    title,
    body: message,
    silent: priority === 'low',
  };

  // iconUrl is a chrome-extension:// URL; we can try to load it
  if (iconUrl && iconUrl.startsWith('chrome-extension://')) {
    try {
      const { protocol } = require('electron');
      // For now, skip icon loading from extension URLs in notifications
      // Electron's Notification doesn't easily support chrome-extension:// icons
    } catch {}
  }

  try {
    const n = new Notification(notifOptions);
    n.show();
    return Promise.resolve({ id: id || String(Date.now()) });
  } catch (e) {
    return Promise.reject(e);
  }
}

function handleNotificationClear(id) {
  // Electron doesn't support programmatic notification dismissal
  return Promise.resolve(true);
}

function handleNotificationGetAll() {
  return Promise.resolve([]);
}

module.exports = {
  handleNotificationCreate,
  handleNotificationClear,
  handleNotificationGetAll,
};
