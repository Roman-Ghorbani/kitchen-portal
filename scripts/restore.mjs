#!/usr/bin/env node
/**
 * Restores a backup made by scripts/backup.mjs.
 *
 *   npm run restore -- --verify                    check the newest backup, change nothing
 *   npm run restore -- --verify --from <archive>   check a specific one
 *   npm run restore -- --from <archive>            restore it (app must be stopped)
 *   npm run restore -- --from <archive> --with-env also put back the env file
 *   npm run restore -- --from old/kitchen.db       a bare SQLite file, e.g. from the
 *                                                  backup scripts this replaced
 *
 * Restoring, in order:
 *   1. Decrypt (if needed), unpack to a temp directory and check every
 *      SHA-256 in the manifest. A damaged or tampered archive stops here.
 *   2. Open the snapshot and run integrity and foreign-key checks, and compare
 *      every table's row count to the manifest.
 *   3. Refuse to continue if the app is still answering on its health URL -
 *      replacing a SQLite file under a running process loses writes silently.
 *      Stop the service first (the script says how), or pass --force.
 *   4. Set the current database aside as `<db>.pre-restore-<time>` (with its
 *      -wal and -shm), then move the snapshot into place.
 *   5. Apply any migrations newer than the backup, so an old backup comes up
 *      on the current schema.
 *   6. Re-check integrity and counts on the restored file.
 *
 * The env file is only restored with --with-env. If one already exists it is
 * written alongside as `<name>.restored` for comparison rather than
 * overwritten.
 */

import './load-env.mjs';

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { unpack, inspect, APP } from './backup-format.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ROOT = process.cwd();
const TARGET = resolve(argValue('--to') ?? process.env.DATABASE_FILE ?? './data/kitchen.db');
const DIRS = [process.env.BACKUP_DIR, '/mnt/usb-backup/kitchen-portal', './backups'].filter(Boolean);
const PASSPHRASE = process.env.BACKUP_PASSPHRASE ?? '';
const HEALTH = process.env.HEALTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`;

const log = (msg) => console.log(`[restore] ${msg}`);
function fail(msg) {
  console.error(`[restore] FAILED: ${msg}`);
  process.exit(1);
}

function newestArchive() {
  for (const dir of DIRS.map((d) => resolve(d))) {
    if (!existsSync(dir)) continue;
    const found = readdirSync(dir)
      .filter((f) => f.startsWith(`${APP}-`) && /\.tar\.gz(\.enc)?$/.test(f))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (found.length) return found[0];
  }
  return null;
}

function sameCounts(actual, expected) {
  const diffs = Object.entries(expected).filter(([t, n]) => actual[t] !== n);
  return diffs.map(([t, n]) => `${t}: expected ${n}, found ${actual[t]}`);
}

/** Wraps a plain .db file so it goes through the same checks as an archive. */
function bareDatabase(file) {
  const cleanup = mkdtempSync(join(tmpdir(), `${APP}-restore-`));
  copyFileSync(file, join(cleanup, 'kitchen.db'));
  const { counts } = inspect(join(cleanup, 'kitchen.db'));
  const manifest = {
    createdAt: statSync(file).mtime.toISOString(),
    commit: null,
    counts,
    includesEnv: false,
  };
  return { root: cleanup, manifest, cleanup };
}

async function appIsRunning() {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const archive = argValue('--from') ? resolve(argValue('--from')) : newestArchive();
  if (!archive || !existsSync(archive)) fail('no backup found; pass --from <archive>');
  log(`archive ${archive}`);

  // 1-2. Unpack and verify before touching anything.
  const { root, manifest, cleanup } = archive.endsWith('.db')
    ? bareDatabase(archive)
    : unpack(archive, PASSPHRASE, { verifyFiles: true });
  try {
    const snapshot = join(root, 'kitchen.db');
    const { counts } = inspect(snapshot);
    const drift = sameCounts(counts, manifest.counts);
    if (drift.length) fail(`snapshot does not match its manifest: ${drift.join('; ')}`);
    log(
      `verified: taken ${manifest.createdAt}${manifest.commit ? ` at ${manifest.commit}` : ''}, ` +
        `${counts.members ?? 0} members, ${counts.events ?? 0} audit events, env ${manifest.includesEnv ? 'included' : 'not included'}`,
    );

    if (flag('--verify')) {
      log('verify only - nothing changed');
      return;
    }

    // 3. Never swap the file under a live process.
    if ((await appIsRunning()) && !flag('--force')) {
      fail(
        `the app is still answering at ${HEALTH}. Stop it first:\n` +
          '    sudo systemctl stop kitchen-portal\n' +
          'then run this again, and start it afterwards.',
      );
    }

    // 4. Keep what was there, then move the snapshot in.
    mkdirSync(dirname(TARGET), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (existsSync(TARGET)) {
      const aside = `${TARGET}.pre-restore-${stamp}`;
      for (const ext of ['', '-wal', '-shm']) {
        if (existsSync(TARGET + ext)) renameSync(TARGET + ext, aside + ext);
      }
      log(`current database set aside as ${aside}`);
    }
    const incoming = `${TARGET}.incoming`;
    copyFileSync(snapshot, incoming);
    renameSync(incoming, TARGET);

    // 5. Bring an older backup up to the current schema.
    const sqlite = new Database(TARGET);
    sqlite.pragma('journal_mode = WAL');
    migrate(drizzle(sqlite), { migrationsFolder: join(ROOT, 'drizzle') });
    sqlite.close();

    // 6. Check the result.
    const after = inspect(TARGET);
    const lost = sameCounts(
      after.counts,
      Object.fromEntries(Object.entries(manifest.counts).filter(([t]) => t in after.counts && t !== '__drizzle_migrations')),
    );
    if (lost.length) fail(`restored database differs from the backup: ${lost.join('; ')}`);
    log(`restored to ${TARGET}`);

    if (flag('--with-env')) {
      if (!manifest.includesEnv) {
        log('this backup has no env file (it was taken without BACKUP_PASSPHRASE)');
      } else {
        const dest = join(ROOT, '.env.production');
        const out = existsSync(dest) ? `${dest}.restored` : dest;
        copyFileSync(join(root, 'app.env'), out);
        log(`env file written to ${out}`);
      }
    }
    log('done. Start the app again: sudo systemctl start kitchen-portal');
  } finally {
    rmSync(cleanup, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
