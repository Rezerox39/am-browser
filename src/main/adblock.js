'use strict';

const { session } = require('electron');
const fs = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const config = require('./config');
const logger = require('./logger');

const FILTERS_DIR = path.join(__dirname, '..', 'shared', 'filters');

let blocker = null;
let initialized = false;
let siteAdblockState = new Map();

function init() {
  if (initialized) return;
  initialized = true;

  const cfg = config.get().adblock;
  if (!cfg.enabled) {
    logger.info('adblock', 'Ad blocking disabled in config');
    return;
  }

  try {
    blocker = createBlocker();
    if (blocker) {
      wireSession();
      const s = blocker.stats ? blocker.stats() : {};
      logger.info('adblock', `Initialized — ${s.networkFilters || '?'} network filters, ${s.cosmeticsFilters || '?'} cosmetic filters`);
    }
  } catch (e) {
    logger.error('adblock', 'Failed to initialize blocker', { error: e.message });
    blocker = null;
  }
}

function createBlocker() {
  const parts = [];

  // 1. Starter rules (YouTube-specific)
  const starterPath = path.join(FILTERS_DIR, 'starter.txt');
  try {
    if (fs.existsSync(starterPath)) {
      parts.push(fs.readFileSync(starterPath, 'utf8'));
      logger.info('adblock', 'Loaded starter list');
    }
  } catch (e) {
    logger.warn('adblock', 'Failed to load starter list', { error: e.message });
  }

  // 2. EasyList
  const easylistPath = path.join(FILTERS_DIR, 'lists', 'easylist.txt');
  try {
    if (fs.existsSync(easylistPath)) {
      parts.push(fs.readFileSync(easylistPath, 'utf8'));
      logger.info('adblock', 'Loaded EasyList');
    }
  } catch (e) {
    logger.warn('adblock', 'Failed to load EasyList', { error: e.message });
  }

  // 3. EasyPrivacy
  const easyprivacyPath = path.join(FILTERS_DIR, 'lists', 'easyprivacy.txt');
  try {
    if (fs.existsSync(easyprivacyPath)) {
      parts.push(fs.readFileSync(easyprivacyPath, 'utf8'));
      logger.info('adblock', 'Loaded EasyPrivacy');
    }
  } catch (e) {
    logger.warn('adblock', 'Failed to load EasyPrivacy', { error: e.message });
  }

  // 4. User custom rules
  const cfg = config.get().adblock;
  if (Array.isArray(cfg.customRules) && cfg.customRules.length > 0) {
    parts.push(cfg.customRules.join('\n'));
  }

  if (parts.length === 0) {
    logger.warn('adblock', 'No filter lists found');
    return null;
  }

  const combined = parts.join('\n');
  const t0 = Date.now();
  const instance = ElectronBlocker.parse(combined);
  logger.info('adblock', `Parsed filters in ${Date.now() - t0}ms`);
  return instance;
}

// Wire our own webRequest handlers that delegate to Ghostery's match().
// This allows per-site adblock overrides AND uses Ghostery's battle-tested
// filter engine for the actual blocking logic.
function wireSession() {
  if (!blocker) return;
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, cb) => {
      try {
        // Per-site adblock override
        const siteEnabled = getSiteAdblock(details.tabId);
        if (!siteEnabled) return cb({});

        // Delegate to Ghostery blocker (it handles mainFrame passthrough internally)
        blocker.onBeforeRequest(details, cb);
      } catch (e) {
        cb({});
      }
    }
  );

  // CSP header manipulation (blocks injected ad scripts via Content-Security-Policy)
  ses.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'] },
    (details, cb) => {
      try {
        blocker.onHeadersReceived(details, cb);
      } catch (e) {
        cb({});
      }
    }
  );

  logger.info('adblock', 'Session handlers registered');
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

function reload(newCfg) {
  try {
    const ses = session.defaultSession;
    // Remove existing handlers
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
    ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, null);
  } catch {}

  const cfg = newCfg || config.get().adblock;
  if (!cfg.enabled) {
    blocker = null;
    logger.info('adblock', 'Ad blocking disabled — handlers removed');
    return;
  }

  try {
    blocker = createBlocker();
    if (blocker) {
      wireSession();
    }
  } catch (e) {
    logger.error('adblock', 'Failed to reload', { error: e.message });
    blocker = null;
  }
}

function stats() {
  if (!blocker) return { networkFilters: 0, cosmeticsFilters: 0, rules: 0 };
  try {
    const s = blocker.stats ? blocker.stats() : {};
    return { rules: s.networkFilters || 0, networkFilters: s.networkFilters || 0, cosmeticsFilters: s.cosmeticsFilters || 0 };
  } catch {
    return { rules: 0, networkFilters: 0, cosmeticsFilters: 0 };
  }
}

function isEnabled() {
  return config.get().adblock.enabled;
}

module.exports = { init, setSiteAdblock, getSiteAdblock, removeSite, reload, stats, isEnabled };
