#!/usr/bin/env node

/**
 * Universal Backup Utility for KitchenTracker (.cjs)
 * Works on any Node version (Node 18+) without requiring TypeScript transpilation or sqlite3 CLI.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    Database = DatabaseSync;
  } catch {}
}

const HERE = path.resolve(__dirname, '..');

async function run() {
  // Path discovery for database
  let sourceDb = process.env.DATABASE_FILE || '';
  if (!sourceDb || !fs.existsSync(sourceDb)) {
    for (const cand of [
      path.join(HERE, 'data', 'kitchen.db'),
      '/home/zbt/KitchenTracker/data/kitchen.db',
      '/srv/kitchen-data/kitchen.db',
      '/srv/kitchen/data/kitchen.db',
    ]) {
      if (fs.existsSync(cand)) {
        sourceDb = cand;
        break;
      }
    }
  }

  if (!sourceDb || !fs.existsSync(sourceDb)) {
    console.error(`[kitchen-tracker backup] ERROR: Database file not found!`);
    process.exit(1);
  }

  // Target discovery
  const USB_DIR = '/mnt/usb-backup/kitchen-tracker';
  let TARGET_BASE = fs.existsSync('/mnt/usb-backup') ? USB_DIR : path.join(HERE, 'backups');

  const destArgIdx = process.argv.indexOf('--dest');
  if (destArgIdx !== -1 && process.argv[destArgIdx + 1]) {
    TARGET_BASE = path.resolve(process.argv[destArgIdx + 1]);
  } else if (process.argv[2] && !process.argv[2].startsWith('--')) {
    TARGET_BASE = path.resolve(process.argv[2]);
  }

  const LATEST_DIR = path.join(TARGET_BASE, 'latest');
  const ARCHIVES_DIR = path.join(TARGET_BASE, 'archives');

  console.log(`[kitchen-tracker backup] Starting KitchenTracker backup...`);
  console.log(`[kitchen-tracker backup] Database source: ${sourceDb}`);
  console.log(`[kitchen-tracker backup] Target directory: ${TARGET_BASE}`);

  fs.mkdirSync(LATEST_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const latestDb = path.join(LATEST_DIR, 'kitchen.db');
  const archiveTar = path.join(ARCHIVES_DIR, `kitchen-${stamp}.tar.gz`);

  // 1. Hot atomic snapshot via SQLite API or safe copy
  if (Database) {
    try {
      const db = new Database(sourceDb, { readonly: true });
      if (typeof db.backup === 'function') {
        await db.backup(latestDb);
        db.close();
      } else {
        db.close();
        fs.copyFileSync(sourceDb, latestDb);
      }
    } catch {
      fs.copyFileSync(sourceDb, latestDb);
    }
  } else {
    fs.copyFileSync(sourceDb, latestDb);
  }

  // 2. Verify snapshot
  if (Database) {
    try {
      const check = new Database(latestDb, { readonly: true });
      const members = check.prepare('SELECT COUNT(*) n FROM members').get()?.n ?? 0;
      const assignments = check.prepare('SELECT COUNT(*) n FROM assignments').get()?.n ?? 0;
      const events = check.prepare('SELECT COUNT(*) n FROM events').get()?.n ?? 0;
      check.close();
      console.log(`[kitchen-tracker backup] Verified snapshot: ${members} members, ${assignments} assignments, ${events} events`);
    } catch (err) {
      console.warn(`[kitchen-tracker backup] Integrity check note:`, err.message);
    }
  }

  // 3. Backup uploads directory
  const uploadsDir = path.join(path.dirname(sourceDb), 'uploads');
  const latestUploads = path.join(LATEST_DIR, 'uploads');
  fs.mkdirSync(latestUploads, { recursive: true });

  if (fs.existsSync(uploadsDir)) {
    for (const f of fs.readdirSync(uploadsDir)) {
      const p = path.join(uploadsDir, f);
      if (fs.statSync(p).isFile()) {
        fs.copyFileSync(p, path.join(latestUploads, f));
      }
    }
  }

  // 4. Backup environment files
  const appDir = path.dirname(path.dirname(sourceDb));
  for (const envFile of ['.env.production', '.env.local', '.env']) {
    const p = path.join(appDir, envFile);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(LATEST_DIR, envFile));
      break;
    }
  }

  // 5. Backup service & Caddy files
  if (fs.existsSync('/etc/systemd/system/kitchen.service')) {
    try { fs.copyFileSync('/etc/systemd/system/kitchen.service', path.join(LATEST_DIR, 'kitchen.service')); } catch {}
  }
  if (fs.existsSync('/etc/caddy/Caddyfile')) {
    try { fs.copyFileSync('/etc/caddy/Caddyfile', path.join(LATEST_DIR, 'Caddyfile')); } catch {}
  }

  // 6. Write manifest
  const manifest = {
    app: 'kitchen-tracker',
    timestamp: new Date().toISOString(),
    dbSize: fs.statSync(latestDb).size,
    sourceDb: sourceDb
  };
  fs.writeFileSync(path.join(LATEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 7. Create compressed archive
  try {
    execSync(`tar -czf "${archiveTar}" -C "${TARGET_BASE}" latest`, { stdio: 'pipe' });
    console.log(`[kitchen-tracker backup] Archive created: ${archiveTar} (${(fs.statSync(archiveTar).size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    try {
      const archiveDb = path.join(ARCHIVES_DIR, `kitchen-${stamp}.db`);
      fs.copyFileSync(latestDb, archiveDb);
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
    for (const f of fs.readdirSync(ARCHIVES_DIR)) {
      const p = path.join(ARCHIVES_DIR, f);
      if (now - fs.statSync(p).mtimeMs > maxAgeMs) {
        fs.unlinkSync(p);
        console.log(`[kitchen-tracker backup] Pruned old archive: ${f}`);
      }
    }
  } catch (err) {}

  console.log(`[kitchen-tracker backup] Backup completed successfully.`);
}

run().catch(err => {
  console.error('[kitchen-tracker backup] Fatal error:', err);
  process.exit(1);
});
