
'use strict';

const config = require('./config');
const logger = require('./logger');

const MAX_ENTRIES = 2000;

let pendingWrite = null;

function add(entry) {
  const { url, title } = entry;
  if (!url || url.startsWith('am://') || url.startsWith('data:') || url.startsWith('about:')) return;
  const cfg = config.get();
  const list = cfg.history || [];
  // Dedupe consecutive same-URL entries
  if (list.length > 0 && list[0].url === url) {
    list[0].title = title || list[0].title;
    list[0].lastVisited = Date.now();
  } else {
    list.unshift({
      url,
      title: title || url,
      visitedAt: Date.now(),
      lastVisited: Date.now(),
    });
  }
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  cfg.history = list;
  config.scheduleSave();
}

function search(query, limit = 50) {
  const q = (query || '').toLowerCase();
  const list = config.get().history || [];
  if (!q) return list.slice(0, limit);
  return list.filter(
    (e) => (e.url && e.url.toLowerCase().includes(q)) || (e.title && e.title.toLowerCase().includes(q))
  ).slice(0, limit);
}

function getRecent(limit = 100) {
  return (config.get().history || []).slice(0, limit);
}

function clear() {
  config.update((d) => { d.history = []; });
  logger.info('history', 'History cleared');
}

module.exports = { add, search, getRecent, clear };
