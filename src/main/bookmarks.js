
'use strict';

const config = require('./config');
const logger = require('./logger');

function add(entry) {
  const { url, title, favicon } = entry;
  if (!url) return null;
  const cfg = config.get();
  const list = cfg.bookmarks || [];
  // Deduplicate by URL
  const existing = list.find((b) => b.url === url);
  if (existing) return existing;
  const bm = {
    id: 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    url,
    title: title || url,
    favicon: favicon || '',
    addedAt: Date.now(),
  };
  list.unshift(bm);
  cfg.bookmarks = list;
  config.scheduleSave();
  logger.info('bookmarks', 'Added', { url });
  return bm;
}

function remove(id) {
  config.update((d) => {
    d.bookmarks = (d.bookmarks || []).filter((b) => b.id !== id);
  });
  logger.info('bookmarks', 'Removed', { id });
}

function getByUrl(url) {
  return (config.get().bookmarks || []).find((b) => b.url === url) || null;
}

function getAll() {
  return config.get().bookmarks || [];
}

function clear() {
  config.update((d) => { d.bookmarks = []; });
  logger.info('bookmarks', 'All bookmarks cleared');
}

module.exports = { add, remove, getByUrl, getAll, clear };
