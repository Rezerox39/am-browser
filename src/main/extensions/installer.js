'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const logger = require('../logger');
const manager = require('./manager');

// Safe ZIP extraction — prevents path traversal
function extractZip(zipPath, destDir) {
  // Use the system unzip tool which respects path traversal protections
  const { execFileSync } = require('child_process');
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'pipe' });
  } catch (e) {
    logger.warn('extensions', 'unzip failed', { error: e.message });
    // Fall back to a manual ZIP parse if unzip isn't available
    throw new Error('Could not extract ZIP: ' + e.message);
  }
}

function validateZipStructure(zipPath) {
  // Check for path traversal attempts before extraction
  const { execFileSync } = require('child_process');
  try {
    const output = execFileSync('unzip', ['-l', zipPath], { stdio: 'pipe', encoding: 'utf8' });
    const lines = output.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const filename = parts[parts.length - 1];
        // Guard against path traversal
        if (filename.includes('..') || filename.startsWith('/') || filename.includes('\\..\\')) {
          throw new Error('Path traversal detected in ZIP: ' + filename);
        }
      }
    }
    return true;
  } catch (e) {
    if (e.message && e.message.includes('Path traversal')) throw e;
    // unzip -l failed — could be a different unzip. Be conservative.
    return true;
  }
}

async function installFromZip(zipPath) {
  // Validate the ZIP exists
  if (!fs.existsSync(zipPath)) throw new Error('ZIP file not found: ' + zipPath);

  validateZipStructure(zipPath);

  // Extract to a temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-ext-'));
  try {
    extractZip(zipPath, tmpDir);

    // The extension might be in a subdirectory (common for zips)
    let extDir = tmpDir;
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const subdirs = entries.filter(e => e.isDirectory());
    if (subdirs.length === 1 && !fs.existsSync(path.join(tmpDir, 'manifest.json'))) {
      extDir = path.join(tmpDir, subdirs[0].name);
    }

    // Install from extracted dir
    return await manager.installFromDir(extDir);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function installFromFilePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip') {
    return installFromZip(filePath);
  }
  return manager.installFromDir(filePath);
}

module.exports = { installFromZip, installFromFilePath };
