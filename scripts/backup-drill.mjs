#!/usr/bin/env node
/**
 * A disaster-recovery drill that proves a backup restores the exact state.
 *
 *   npm run backup:drill
 *
 * Works on a copy - the live database is only ever read:
 *   1. copies the live database to a scratch directory
 *   2. takes an encrypted backup of the copy with scripts/backup.mjs
 *   3. overwrites the copy with random bytes (the "disaster")
 *   4. restores it with scripts/restore.mjs
 *   5. compares every table, row for row, against the original
 *   6. checks that a wrong passphrase and a tampered archive are both refused
 *
 * Exits non-zero if anything differs. Worth running after any change to the
 * backup scripts or the schema, and once a semester regardless.
 */

import './load-env.mjs';

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';

const LIVE = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');
const scratch = mkdtempSync(join(tmpdir(), 'kitchen-portal-drill-'));
const db = join(scratch, 'kitchen.db');
const backups = join(scratch, 'backups');
const env = {
  ...process.env,
  DATABASE_FILE: db,
  BACKUP_DIR: backups,
  BACKUP_PASSPHRASE: randomBytes(18).toString('base64url'),
  HEALTH_URL: 'http://127.0.0.1:9/unreachable',
};

const run = (script, args = [], extra = {}) =>
  execFileSync(process.execPath, [script, ...args], { env: { ...env, ...extra }, stdio: 'pipe' }).toString();

function fingerprint(file) {
  const conn = new Database(file, { readonly: true });
  const tables = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const out = {};
  for (const t of tables) {
    const rows = conn.prepare(`SELECT * FROM "${t}" ORDER BY 1`).all();
    out[t] = `${rows.length}:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
  }
  conn.close();
  return out;
}

function step(label, fn) {
  try {
    const detail = fn();
    console.log(`  ok    ${label}${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err.message}`);
    rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  }
}

console.log(`Backup drill against a copy of ${LIVE}\n`);

const src = new Database(LIVE, { readonly: true, fileMustExist: true });
await src.backup(db);
src.close();

let before;
step('copy the live database', () => {
  before = fingerprint(db);
  return `${Object.keys(before).length} tables`;
});

let archive;
step('take an encrypted backup', () => {
  run('scripts/backup.mjs');
  archive = join(backups, readdirSync(backups)[0]);
  return archive.split('/').pop();
});

step('destroy the database', () => {
  writeFileSync(db, randomBytes(64 * 1024));
  rmSync(`${db}-wal`, { force: true });
  rmSync(`${db}-shm`, { force: true });
});

step('restore from the backup', () => {
  run('scripts/restore.mjs', ['--from', archive]);
});

step('every table matches row for row', () => {
  const after = fingerprint(db);
  const diffs = Object.keys(before).filter((t) => before[t] !== after[t]);
  if (diffs.length) throw new Error(`differs: ${diffs.join(', ')}`);
  return `${Object.keys(after).length} tables identical`;
});

step('a wrong passphrase is refused', () => {
  try {
    run('scripts/restore.mjs', ['--verify', '--from', archive], { BACKUP_PASSPHRASE: 'wrong' });
  } catch {
    return;
  }
  throw new Error('it was accepted');
});

step('a tampered archive is refused', () => {
  const bad = join(scratch, 'tampered.tar.gz.enc');
  const bytes = readFileSync(archive);
  bytes[bytes.length - 10] ^= 0xff;
  writeFileSync(bad, bytes);
  try {
    run('scripts/restore.mjs', ['--verify', '--from', bad]);
  } catch {
    return;
  }
  throw new Error('it was accepted');
});

rmSync(scratch, { recursive: true, force: true });
console.log('\nDrill passed: the backup restores the exact state.');
