/**
 * Pulls a consistent snapshot of the database and configurations to USB or local directory.
 *
 * Uses SQLite's own backup API rather than copying the file: a plain copy can
 * catch the database mid-write and produce something that will not open.
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- /custom/destination
 */

import { existsSync, mkdirSync, statSync, copyFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

import Database from 'better-sqlite3';

const HERE = process.cwd();
const source = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');
const uploadsDir = resolve('./data/uploads');

if (!existsSync(source)) {
  console.error(`[kitchen-tracker backup] ERROR: No database at ${source}`);
  process.exit(1);
}

// Default target: USB drive if mounted, otherwise local ./backups
const USB_DIR = '/mnt/usb-backup/kitchen-tracker';
let TARGET_BASE = existsSync('/mnt/usb-backup') ? USB_DIR : resolve('./backups');

if (process.argv[2] && !process.argv[2].startsWith('--')) {
  TARGET_BASE = resolve(process.argv[2]);
}

const LATEST_DIR = join(TARGET_BASE, 'latest');
const ARCHIVES_DIR = join(TARGET_BASE, 'archives');

console.log(`[kitchen-tracker backup] Starting backup...`);
console.log(`[kitchen-tracker backup] Target directory: ${TARGET_BASE}`);

mkdirSync(LATEST_DIR, { recursive: true });
mkdirSync(ARCHIVES_DIR, { recursive: true });

const stamp = new Date()
  .toISOString()
  .slice(0, 16)
  .replace(/[:T]/g, '-');

const latestDb = join(LATEST_DIR, 'kitchen.db');
const archiveTar = join(ARCHIVES_DIR, `kitchen-${stamp}.tar.gz`);

// 1. Hot snapshot of SQLite database
const db = new Database(source, { readonly: true });
await db.backup(latestDb);
db.close();

// 2. Verify snapshot integrity
const check = new Database(latestDb, { readonly: true });
let membersCount = 0, assignmentsCount = 0, eventsCount = 0, latePlatesCount = 0;
try {
  membersCount = (check.prepare('SELECT COUNT(*) n FROM members').get() as { n: number })?.n ?? 0;
  assignmentsCount = (check.prepare('SELECT COUNT(*) n FROM assignments').get() as { n: number })?.n ?? 0;
  eventsCount = (check.prepare('SELECT COUNT(*) n FROM events').get() as { n: number })?.n ?? 0;
  try {
    latePlatesCount = (check.prepare('SELECT COUNT(*) n FROM late_plates').get() as { n: number })?.n ?? 0;
  } catch {}
} finally {
  check.close();
}

console.log(`[kitchen-tracker backup] Verified snapshot:`);
console.log(`  - Members: ${membersCount}`);
console.log(`  - Assignments: ${assignmentsCount}`);
console.log(`  - Logged events: ${eventsCount}`);
console.log(`  - Late plates: ${latePlatesCount}`);

// 3. Backup uploads directory
const latestUploads = join(LATEST_DIR, 'uploads');
mkdirSync(latestUploads, { recursive: true });
let uploadedFilesCount = 0;
if (existsSync(uploadsDir)) {
  for (const f of readdirSync(uploadsDir)) {
    const srcPath = join(uploadsDir, f);
    if (statSync(srcPath).isFile()) {
      copyFileSync(srcPath, join(latestUploads, f));
      uploadedFilesCount++;
    }
  }
}

// 4. Backup environment files
for (const envFile of ['.env.production', '.env.local', '.env']) {
  const envSrc = resolve(envFile);
  if (existsSync(envSrc)) {
    copyFileSync(envSrc, join(LATEST_DIR, envFile));
  }
}

// 5. Backup systemd / Caddy configs if present
for (const cfg of ['/etc/systemd/system/kitchen.service', '/etc/caddy/Caddyfile']) {
  if (existsSync(cfg)) {
    try {
      copyFileSync(cfg, join(LATEST_DIR, cfg.split('/').pop()!));
    } catch {}
  }
}

// 6. Write manifest
const manifest = {
  app: 'kitchen-tracker',
  timestamp: new Date().toISOString(),
  dbSize: statSync(latestDb).size,
  counts: {
    members: membersCount,
    assignments: assignmentsCount,
    events: eventsCount,
    latePlates: latePlatesCount,
    uploads: uploadedFilesCount,
  }
};
writeFileSync(join(LATEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 7. Create compressed archive
try {
  execSync(`tar -czf "${archiveTar}" -C "${TARGET_BASE}" latest`, { stdio: 'pipe' });
  console.log(`[kitchen-tracker backup] Archive created: ${archiveTar} (${(statSync(archiveTar).size / 1024).toFixed(1)} KB)`);
} catch (err) {
  // Gzip fallback for db
  try {
    const archiveDb = join(ARCHIVES_DIR, `kitchen-${stamp}.db`);
    copyFileSync(latestDb, archiveDb);
    execSync(`gzip -f "${archiveDb}"`, { stdio: 'pipe' });
    console.log(`[kitchen-tracker backup] Archive created (gzip): ${archiveDb}.gz`);
  } catch {
    console.log(`[kitchen-tracker backup] Snapshot saved directly to ${latestDb}`);
  }
}

// 8. Prune archives older than 60 days
try {
  const now = Date.now();
  const maxAgeMs = 60 * 24 * 60 * 60 * 1000;
  for (const f of readdirSync(ARCHIVES_DIR)) {
    const p = join(ARCHIVES_DIR, f);
    if (now - statSync(p).mtimeMs > maxAgeMs) {
      unlinkSync(p);
      console.log(`[kitchen-tracker backup] Pruned old archive: ${f}`);
    }
  }
} catch (err) {
  console.warn(`[kitchen-tracker backup] Archive prune warning:`, err);
}

console.log(`[kitchen-tracker backup] Backup completed and verified.`);
