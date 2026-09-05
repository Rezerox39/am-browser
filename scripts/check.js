'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let errors = 0;

console.log('\n> Syntax checking all JS files...');
const jsFiles = [];
function findJS(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) findJS(full);
    else if (f.endsWith('.js')) jsFiles.push(full);
  }
}
findJS(path.join(ROOT, 'src'));
findJS(path.join(ROOT, 'scripts'));
for (const f of jsFiles) {
  try {
    execSync('node --check ' + JSON.stringify(f), { stdio: 'pipe' });
  } catch (e) {
    console.error('  X ' + path.relative(ROOT, f));
    errors++;
  }
}
console.log('  Checked ' + jsFiles.length + ' files');

console.log('\n> Validating locale JSON files...');
const localeDir = path.join(ROOT, 'src', 'shared', 'i18n', 'locales');
let locales = [];
if (fs.existsSync(localeDir)) {
  locales = fs.readdirSync(localeDir).filter((f) => f.endsWith('.json'));
  for (const loc of locales) {
    try { JSON.parse(fs.readFileSync(path.join(localeDir, loc), 'utf8')); }
    catch (e) { console.error('  X Invalid JSON: ' + loc); errors++; }
  }
  console.log('  Checked ' + locales.length + ' locale files');
}

console.log('\n> Verifying project structure...');
const required = [
  'package.json', 'src/main/main.js', 'src/preload/preload.js',
  'src/renderer/index.html', 'src/renderer/app.js',
  'src/renderer/styles/global.css',
  'src/shared/i18n/locales/en.json',
  'src/shared/filters/starter.txt', 'docs/README.md',
];
for (const f of required) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.error('  X Missing: ' + f); errors++; }
}
console.log('  Structure check complete');

console.log('\n> Checking package.json...');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (!pkg.main || !pkg.scripts || !pkg.scripts.start) {
  console.error('  X Missing main or scripts.start'); errors++;
} else { console.log('  package.json valid'); }

console.log('\n> Verifying locale key coverage...');
if (fs.existsSync(localeDir) && locales.length > 1) {
  const en = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
  const enKeys = Object.keys(en).sort();
  for (const loc of locales) {
    if (loc === 'en.json') continue;
    const locKeys = Object.keys(JSON.parse(fs.readFileSync(path.join(localeDir, loc), 'utf8'))).sort();
    const missing = enKeys.filter((k) => !locKeys.includes(k));
    const extra = locKeys.filter((k) => !enKeys.includes(k));
    if (missing.length || extra.length) {
      console.log('  Warning: ' + loc + ': missing ' + missing.length + ', extra ' + extra.length);
    }
  }
}
console.log('  Key coverage check complete');

console.log('\n========================================');
if (errors > 0) { console.error(errors + ' error(s) found'); process.exit(1); }
else { console.log('All checks passed'); process.exit(0); }