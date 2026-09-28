#!/usr/bin/env node
/**
 * Takes a verified, self-describing backup of the whole app state.
 *
 *   npm run backup                       # to BACKUP_DIR, the USB drive, or ./backups
 *   npm run backup -- --dest /some/dir
 *
 * What "the whole state" means here: the SQLite database (every table - the
 * roster, weeks, points, late plates, menus, paired tablets, the audit log)
 * and the environment file, without which the database is not enough - the
 * session secret signs every cookie, calendar link and setup-code hash, and
 * the manager's credentials live there too.
 *
 * How:
 *   1. Snapshot the database with SQLite's online backup API, which is safe
 *      while the app is writing. A file copy is not.
 *   2. Check the snapshot: PRAGMA integrity_check, foreign_key_check, and a
 *      row count for every table.
 *   3. Write manifest.json: the counts, the schema version, a SHA-256 for
 *      every file, the git commit that took it.
 *   4. Pack it as a .tar.gz and, when BACKUP_PASSPHRASE is set, encrypt it
 *      with AES-256-GCM (key from scrypt). The drive sits in the house; the
 *      passphrase lives in the Pi's environment and your password manager.
 *      Without a passphrase the env file is left out rather than written in
 *      the clear, and the backup says so.
 *   5. Re-open the archive and verify every checksum before calling it done.
 *   6. Delete archives older than BACKUP_KEEP_DAYS (default 60).
 *
 * Exits non-zero on any failure, so a systemd timer or cron job records it.
 * Runs on Node 20+ with no TypeScript step. Restore with scripts/restore.mjs.
 */

import './load-env.mjs';

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { encrypt, sha256File, readManifest, inspect, APP, FORMAT } from './backup-format.mjs';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ROOT = process.cwd();
const SOURCE = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');
const USB = '/mnt/usb-backup/kitchen-portal';
const DEST = resolve(
  argValue('--dest') ??
    process.env.BACKUP_DIR ??
    (existsSync('/mnt/usb-backup') ? USB : './backups'),
);
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 60);
const PASSPHRASE = process.env.BACKUP_PASSPHRASE ?? '';
const ENV_FILES = ['.env.production', '.env.local', '.env'];

function log(msg) {
  console.log(`[backup] ${msg}`);
}

function fail(msg) {
  console.error(`[backup] FAILED: ${msg}`);
  process.exit(1);
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(SOURCE)) fail(`no database at ${SOURCE}`);
  mkdirSync(DEST, { recursive: true, mode: 0o700 });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `${APP}-${stamp}`;
  const work = mkdtempSync(join(tmpdir(), `${APP}-backup-`));
  const stage = join(work, name);
  mkdirSync(stage);

  try {
    // 1. Online snapshot.
    log(`snapshotting ${SOURCE}`);
    const live = new Database(SOURCE, { readonly: true, fileMustExist: true });
    await live.backup(join(stage, 'kitchen.db'));
    live.close();

    // 2. Check it.
    const { counts, schemaHead } = inspect(join(stage, 'kitchen.db'));
    log(`snapshot ok: ${counts.members ?? 0} members, ${counts.assignments ?? 0} assignments, ${counts.events ?? 0} audit events`);

    // The environment file travels only inside an encrypted archive.
    const envFile = ENV_FILES.find((f) => existsSync(join(ROOT, f)));
    const includeEnv = Boolean(envFile && PASSPHRASE);
    if (includeEnv) copyFileSync(join(ROOT, envFile), join(stage, 'app.env'));
    if (envFile && !PASSPHRASE) {
      log('BACKUP_PASSPHRASE is not set: leaving the env file out rather than writing secrets in the clear');
    }

    // 3. Manifest.
    const files = readdirSync(stage).map((f) => ({ path: f, sha256: sha256File(join(stage, f)), bytes: statSync(join(stage, f)).size }));
    const manifest = {
      format: FORMAT,
      app: APP,
      createdAt: new Date().toISOString(),
      host: process.env.HOSTNAME ?? null,
      commit: gitCommit(),
      source: SOURCE,
      schemaHead,
      counts,
      includesEnv: includeEnv,
      encrypted: Boolean(PASSPHRASE),
      files,
    };
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 4. Pack, then encrypt.
    const tarball = join(work, `${name}.tar.gz`);
    execFileSync('tar', ['-czf', tarball, '-C', work, name]);
    const target = join(DEST, PASSPHRASE ? `${name}.tar.gz.enc` : `${name}.tar.gz`);
    const packed = readFileSync(tarball);
    writeFileSync(target, PASSPHRASE ? encrypt(packed, PASSPHRASE) : packed, { mode: 0o600 });

    // 5. Prove it reads back.
    const check = readManifest(target, PASSPHRASE, { verifyFiles: true });
    if (check.manifest.counts.events !== counts.events) fail('read-back manifest does not match');
    log(`wrote ${target} (${(statSync(target).size / 1024).toFixed(1)} KB, verified${PASSPHRASE ? ', encrypted' : ''})`);

    // 6. Retention.
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    for (const f of readdirSync(DEST)) {
      if (!f.startsWith(`${APP}-`) || !/\.tar\.gz(\.enc)?$/.test(f)) continue;
      const p = join(DEST, f);
      if (statSync(p).mtimeMs < cutoff && basename(p) !== basename(target)) {
        unlinkSync(p);
        log(`pruned ${f}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
