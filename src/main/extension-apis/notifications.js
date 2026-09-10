'use strict';

const { Notification } = require('electron');
const logger = require('../logger');

// Per-extension notification tracking
const extNotifications = new Map(); // extensionId -> Set<id>

function track(extId, notifId) {
  if (!extNotifications.has(extId)) extNotifications.set(extId, new Set());
  extNotifications.get(extId).add(notifId);
}

function untrack(extId, notifId) {
  const s = extNotifications.get(extId);
  if (s) s.delete(notifId);
}

async function create({ context, args }) {
  const [options = {}] = args;
  const id = options.id || `notif_${Date.now()}`;
  const n = new Notification({ title: options.title || '', body: options.message || options.body || '', silent: options.priority === 'low' });
  n.show();
  track(context.extensionId, id);
  return id;
}

async function update({ context, args }) {
  const [id, options = {}] = args;
  // Electron doesn't support updating shown notifications; create a new one
  const n = new Notification({ title: options.title || '', body: options.message || options.body || '' });
  n.show();
  return true;
}

async function clear({ context, args }) {
  const [id] = args;
  untrack(context.extensionId, id);
  return true;
}

async function getAll({ context }) {
  const s = extNotifications.get(context.extensionId);
  return s ? Array.from(s) : [];
}

function destroyExtension(extensionId) {
  extNotifications.delete(extensionId);
}

module.exports = { create, update, clear, getAll, destroyExtension };
