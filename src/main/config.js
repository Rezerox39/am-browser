
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

const DEFAULTS = {
  language: 'en',
  theme: 'amoled',
  adblock: {
    enabled: true,
    lists: { starter: true },
    customRules: [],
  },
  homePage: 'start',
  newTabPage: 'start',
  searchEngine: 'google',
  askWhereToSave: false,
  blockPopups: true,
  defaultUserAgent: '',
  windowState: { width: 1280, height: 800, x: undefined, y: undefined, maximized: false },
  siteRules: {},
  bookmarks: [],
  history: [],
  downloads: [],
};

let data = null;

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      data = deepMerge(DEFAULTS, JSON.parse(raw));
    } else {
      data = { ...DEFAULTS };
    }
  } catch {
    data = { ...DEFAULTS };
  }
  // Migration: ensure nested objects exist
  if (!data.siteRules) data.siteRules = {};
  if (!data.bookmarks) data.bookmarks = [];
  if (!data.history) data.history = [];
  if (!data.downloads) data.downloads = [];
  if (!data.adblock) data.adblock = DEFAULTS.adblock;
  return data;
}

function save() {
  if (!data) return;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
  } catch { /* best effort */ }
}

// Debounced save
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1000);
}

function get() {
  if (!data) load();
  return data;
}

function set(key, value) {
  if (!data) load();
  data[key] = value;
  scheduleSave();
}

function update(fn) {
  if (!data) load();
  fn(data);
  scheduleSave();
}

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  save();
}

module.exports = { load, save, saveNow, get, set, update, scheduleSave };
