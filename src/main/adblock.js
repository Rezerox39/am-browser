
'use strict';

const { session } = require('electron');
const fs = require('fs');
const path = require('path');
const { AdBlockEngine } = require('../shared/adblock/engine');
const config = require('./config');
const logger = require('./logger');

const FILTERS_DIR = path.join(__dirname, '..', 'shared', 'filters');
let engine = new AdBlockEngine();
let siteAdblockState = new Map(); // wcId -> bool override

function init() {
  const cfg = config.get().adblock;
  engine = new AdBlockEngine({ enabled: cfg.enabled });
  loadBuiltinLists(cfg);
  loadCustomRules(cfg);
  wireSession();
}

function loadBuiltinLists(cfg) {
  if (cfg.lists && cfg.lists.starter) {
    const starterPath = path.join(FILTERS_DIR, 'starter.txt');
    try {
      const contents = fs.readFileSync(starterPath, 'utf8');
      engine.loadList(contents, 'builtin:starter');
      logger.info('adblock', 'Loaded starter list');
    } catch (e) {
      logger.warn('adblock', 'Failed to load starter list', { error: e.message });
    }
  }
}

function loadCustomRules(cfg) {
  if (Array.isArray(cfg.customRules) && cfg.customRules.length > 0) {
    engine.loadList(cfg.customRules.join('
'), 'custom');
  }
}

function setSiteAdblock(wcId, enabled) {
  siteAdblockState.set(wcId, enabled);
}

function getSiteAdblock(wcId) {
  if (siteAdblockState.has(wcId)) return siteAdblockState.get(wcId);
  return config.get().adblock.enabled;
}

function removeSite(wcId) {
  siteAdblockState.delete(wcId);
}

function wireSession() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, cb) => {
      try {
        const url = details.url;
        if (details.resourceType === 'mainFrame') return cb({ cancel: false });
        const siteAdblock = getSiteAdblock(details.tabId);
        if (!siteAdblock) return cb({ cancel: false });
        const originUrl = details.referrer || '';
        const shouldBlock = engine.shouldBlock(url, originUrl);
        cb({ cancel: shouldBlock });
      } catch (e) {
        logger.error('adblock', 'Filter error', { error: e.message });
        cb({ cancel: false });
      }
    }
  );
}

function reload(newCfg) {
  engine.clear();
  const cfg = newCfg || config.get().adblock;
  engine = new AdBlockEngine({ enabled: cfg.enabled });
  loadBuiltinLists(cfg);
  loadCustomRules(cfg);
  logger.info('adblock', 'Reloaded filters', engine.stats());
}

function stats() {
  return engine.stats();
}

function isEnabled() {
  return config.get().adblock.enabled;
}

module.exports = { init, setSiteAdblock, getSiteAdblock, removeSite, reload, stats, isEnabled };
