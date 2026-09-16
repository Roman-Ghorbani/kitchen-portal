/**
 * Restores database, uploads, and environment files from USB backup or local directory.
 *
 * Usage:
 *   npm run db:restore
 *   npm run db:restore -- /custom/source/kitchen.db
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

import Database from 'better-sqlite3';

const HERE = process.cwd();
const targetDb = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');
const uploadsDir = resolve('./data/uploads');

const USB_DIR = '/mnt/usb-backup/kitchen-tracker';
let SOURCE_DB = existsSync(join(USB_DIR, 'latest', 'kitchen.db'))
  ? join(USB_DIR, 'latest', 'kitchen.db')
  : resolve('./backups/latest/kitchen.db');

if (process.argv[2] && !process.argv[2].startsWith('--')) {
  SOURCE_DB = resolve(process.argv[2]);
}

console.log(`[kitchen-tracker restore] Restoring KitchenTracker data...`);
console.log(`[kitchen-tracker restore] Source file: ${SOURCE_DB}`);

if (!existsSync(SOURCE_DB)) {
  console.error(`[kitchen-tracker restore] ERROR: Source backup file ${SOURCE_DB} does not exist!`);
  process.exit(1);
}

// Check if source is an archive
let actualDb = SOURCE_DB;
let tempExtractDir: string | null = null;

if (SOURCE_DB.endsWith('.tar.gz') || SOURCE_DB.endsWith('.tgz')) {
  tempExtractDir = join(HERE, '.restore-temp-' + Date.now());
  mkdirSync(tempExtractDir, { recursive: true });
  try {
    execSync(`tar -xzf "${SOURCE_DB}" -C "${tempExtractDir}"`, { stdio: 'pipe' });
    const extractedDb = join(tempExtractDir, 'latest', 'kitchen.db');
    if (existsSync(extractedDb)) {
      actualDb = extractedDb;
    } else {
      const findDb = (dir: string): string | null => {
        for (const f of readdirSync(dir)) {
          const fp = join(dir, f);
          if (statSync(fp).isDirectory()) {
            const found = findDb(fp);
            if (found) return found;
          } else if (f.endsWith('.db')) {
            return fp;
          }
        }
        return null;
      };
      actualDb = findDb(tempExtractDir) ?? SOURCE_DB;
    }
  } catch (err) {
    console.error(`[kitchen-tracker restore] ERROR: Failed to extract tar archive ${SOURCE_DB}:`, err);
    process.exit(1);
  }
} else if (SOURCE_DB.endsWith('.gz')) {
  const uncompressed = SOURCE_DB.slice(0, -3);
  try {
    const compressedData = readFileSync(SOURCE_DB);
    const decompressedData = gunzipSync(compressedData);
    writeFileSync(uncompressed, decompressedData);
    actualDb = uncompressed;
  } catch (err) {
    console.error(`[kitchen-tracker restore] ERROR: Failed to decompress ${SOURCE_DB}:`, err);
    process.exit(1);
  }
}

// 1. Verify source database integrity before restoring
try {
  const check = new Database(actualDb, { readonly: true });
  const members = (check.prepare('SELECT COUNT(*) n FROM members').get() as { n: number })?.n ?? 0;
  const assignments = (check.prepare('SELECT COUNT(*) n FROM assignments').get() as { n: number })?.n ?? 0;
  check.close();
  console.log(`[kitchen-tracker restore] Verified backup: ${members} members, ${assignments} assignments.`);
} catch (err) {
  console.error(`[kitchen-tracker restore] ERROR: Backup file failed verification:`, err);
  process.exit(1);
}

// 2. Ensure target directories exist and remove stale WAL files
mkdirSync(dirname(targetDb), { recursive: true });
mkdirSync(uploadsDir, { recursive: true });

for (const ext of ['-wal', '-shm']) {
  const p = targetDb + ext;
  if (existsSync(p)) unlinkSync(p);
}

// 3. Restore database file
copyFileSync(actualDb, targetDb);
console.log(`[kitchen-tracker restore] Restored database -> ${targetDb}`);

// 4. Restore uploads if present in backup dir
const srcDir = dirname(actualDb);
const srcUploads = existsSync(join(srcDir, 'uploads'))
  ? join(srcDir, 'uploads')
  : existsSync(join(dirname(srcDir), 'latest', 'uploads'))
    ? join(dirname(srcDir), 'latest', 'uploads')
    : null;

if (srcUploads && existsSync(srcUploads)) {
  let count = 0;
  for (const f of readdirSync(srcUploads)) {
    const s = join(srcUploads, f);
    copyFileSync(s, join(uploadsDir, f));
    count++;
  }
  console.log(`[kitchen-tracker restore] Restored ${count} uploaded files to ${uploadsDir}`);
}

// 5. Restore .env.production if present
for (const envFile of ['.env.production', '.env.local', '.env']) {
  const srcEnv = join(srcDir, envFile);
  const dstEnv = resolve(envFile);
  if (existsSync(srcEnv) && !existsSync(dstEnv)) {
    copyFileSync(srcEnv, dstEnv);
    console.log(`[kitchen-tracker restore] Restored environment file: ${envFile}`);
  }
}

if (tempExtractDir && existsSync(tempExtractDir)) {
  try { rmSync(tempExtractDir, { recursive: true, force: true }); } catch {}
}

console.log(`[kitchen-tracker restore] Restore completed successfully.`);
