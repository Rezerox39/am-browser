'use strict';

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, 'locales');
let currentLocale = 'en';
let strings = {};
let fallback = {};

const available = [];
if (fs.existsSync(localesDir)) {
  for (const f of fs.readdirSync(localesDir)) {
    if (f.endsWith('.json')) available.push(f.replace('.json', ''));
  }
}

function load(locale) {
  const lang = available.includes(locale) ? locale : 'en';
  currentLocale = lang;
  try {
    strings = JSON.parse(fs.readFileSync(path.join(localesDir, lang + '.json'), 'utf8'));
  } catch {
    strings = {};
  }
  if (lang !== 'en') {
    try {
      fallback = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
    } catch { fallback = {}; }
  } else {
    fallback = strings;
  }
}

function t(key, vars) {
  let val = strings[key] || fallback[key] || key;
  if (vars && typeof val === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      val = val.replace(new RegExp('\{\{' + k + '\}\}', 'g'), String(v));
    }
  }
  return val;
}

function getStrings() {
  const merged = {};
  if (fallback && typeof fallback === 'object') Object.assign(merged, fallback);
  if (strings && typeof strings === 'object') Object.assign(merged, strings);
  return merged;
}

function getLocale() { return currentLocale; }
function setLocale(loc) { load(loc); }
function getAvailable() { return [...available]; }

load(currentLocale);

module.exports = { t, getLocale, setLocale, getAvailable, load, getStrings };
