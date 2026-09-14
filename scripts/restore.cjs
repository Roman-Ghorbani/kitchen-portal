#!/usr/bin/env node

/**
 * Universal Restore Utility for KitchenTracker (.cjs)
 * Works on any Node version (Node 18+) without requiring TypeScript transpilation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');

// Destination database discovery
let targetDb = process.env.DATABASE_FILE || '';
if (!targetDb) {
  for (const cand of [
    path.join(HERE, 'data', 'kitchen.db'),
    '/home/zbt/KitchenTracker/data/kitchen.db',
    '/srv/kitchen-data/kitchen.db',
  ]) {
    if (fs.existsSync(cand) || fs.existsSync(path.dirname(cand))) {
      targetDb = cand;
      break;
    }
  }
}
if (!targetDb) targetDb = path.join(HERE, 'data', 'kitchen.db');

const USB_DIR = '/mnt/usb-backup/kitchen-tracker';
let SOURCE_DB = fs.existsSync(path.join(USB_DIR, 'latest', 'kitchen.db'))
  ? path.join(USB_DIR, 'latest', 'kitchen.db')
  : path.join(HERE, 'backups', 'latest', 'kitchen.db');

const fromArgIdx = process.argv.indexOf('--from');
if (fromArgIdx !== -1 && process.argv[fromArgIdx + 1]) {
  SOURCE_DB = path.resolve(process.argv[fromArgIdx + 1]);
} else if (process.argv[2] && !process.argv[2].startsWith('--')) {
  SOURCE_DB = path.resolve(process.argv[2]);
}

console.log(`[kitchen-tracker restore] Restoring KitchenTracker data...`);
console.log(`[kitchen-tracker restore] Source file: ${SOURCE_DB}`);
console.log(`[kitchen-tracker restore] Target database: ${targetDb}`);

if (!fs.existsSync(SOURCE_DB)) {
  console.error(`[kitchen-tracker restore] ERROR: Source backup file ${SOURCE_DB} does not exist!`);
  process.exit(1);
}

// Check if source is a gzip archive
let actualDb = SOURCE_DB;
if (SOURCE_DB.endsWith('.gz')) {
  const uncompressed = SOURCE_DB.slice(0, -3);
  try {
    execSync(`gzip -dc "${SOURCE_DB}" > "${uncompressed}"`, { stdio: 'pipe' });
    actualDb = uncompressed;
  } catch (err) {
    console.error(`[kitchen-tracker restore] ERROR: Failed to decompress ${SOURCE_DB}`, err);
    process.exit(1);
  }
}

// Clean stale WAL and create target dir
fs.mkdirSync(path.dirname(targetDb), { recursive: true });
for (const ext of ['-wal', '-shm']) {
  const p = targetDb + ext;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Copy database
fs.copyFileSync(actualDb, targetDb);
console.log(`[kitchen-tracker restore] Restored database -> ${targetDb} (${(fs.statSync(targetDb).size / 1024).toFixed(1)} KB)`);

// Restore uploads
const srcDir = path.dirname(actualDb);
const srcUploads = fs.existsSync(path.join(srcDir, 'uploads'))
  ? path.join(srcDir, 'uploads')
  : fs.existsSync(path.join(path.dirname(srcDir), 'latest', 'uploads'))
    ? path.join(path.dirname(srcDir), 'latest', 'uploads')
    : null;

const targetUploads = path.join(path.dirname(targetDb), 'uploads');
fs.mkdirSync(targetUploads, { recursive: true });

if (srcUploads && fs.existsSync(srcUploads)) {
  let count = 0;
  for (const f of fs.readdirSync(srcUploads)) {
    fs.copyFileSync(path.join(srcUploads, f), path.join(targetUploads, f));
    count++;
  }
  console.log(`[kitchen-tracker restore] Restored ${count} uploaded files to ${targetUploads}`);
}

// Restore .env.production if present
const appDir = path.dirname(path.dirname(targetDb));
for (const envFile of ['.env.production', '.env.local', '.env']) {
  const srcEnv = path.join(srcDir, envFile);
  const dstEnv = path.join(appDir, envFile);
  if (fs.existsSync(srcEnv) && !fs.existsSync(dstEnv)) {
    fs.copyFileSync(srcEnv, dstEnv);
    console.log(`[kitchen-tracker restore] Restored environment file: ${envFile}`);
    break;
  }
}

console.log(`[kitchen-tracker restore] Restore completed successfully.`);
