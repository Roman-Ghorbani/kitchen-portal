/**
 * The backup file format, shared by backup.mjs and restore.mjs.
 *
 * A backup is `<app>-<timestamp>.tar.gz`, optionally encrypted to `.tar.gz.enc`,
 * containing one directory with:
 *
 *   kitchen.db      SQLite snapshot
 *   app.env         the environment file (encrypted backups only)
 *   manifest.json   counts, schema version, SHA-256 of every other file
 *
 * Encrypted layout: "KPBK1" | salt(16) | iv(12) | tag(16) | ciphertext, with the
 * key derived by scrypt (N=2^15) from BACKUP_PASSPHRASE. GCM authenticates
 * the whole archive, so a truncated or tampered file fails to decrypt rather
 * than restoring garbage.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';

export const APP = 'kitchen-portal';
export const FORMAT = 1;
const MAGIC = Buffer.from('KPBK1');
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const keyFor = (passphrase, salt) => scryptSync(passphrase, salt, 32, SCRYPT);

export function encrypt(plain, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob, passphrase) {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an encrypted kitchen-portal backup');
  if (!passphrase) throw new Error('this backup is encrypted: set BACKUP_PASSPHRASE');
  let o = MAGIC.length;
  const salt = blob.subarray(o, (o += 16));
  const iv = blob.subarray(o, (o += 12));
  const tag = blob.subarray(o, (o += 16));
  const decipher = createDecipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]);
  } catch {
    throw new Error('could not decrypt: wrong passphrase, or the file is damaged');
  }
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Unpacks an archive into a fresh temp directory and checks every checksum.
 * Returns the directory holding the files and the parsed manifest; the
 * caller removes `cleanup` when done.
 */
export function unpack(archive, passphrase, { verifyFiles = true } = {}) {
  const blob = readFileSync(archive);
  const tarball = archive.endsWith('.enc') ? decrypt(blob, passphrase) : blob;
  const cleanup = mkdtempSync(join(tmpdir(), `${APP}-restore-`));
  writeFileSync(join(cleanup, 'archive.tar.gz'), tarball);
  execFileSync('tar', ['-xzf', join(cleanup, 'archive.tar.gz'), '-C', cleanup]);
  const [dir] = readdirSync(cleanup, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (!dir) throw new Error('archive holds no backup directory');
  const root = join(cleanup, dir.name);

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== FORMAT || manifest.app !== APP) throw new Error('not a kitchen-portal backup');
  if (verifyFiles) {
    for (const f of manifest.files) {
      if (sha256File(join(root, f.path)) !== f.sha256) throw new Error(`checksum mismatch: ${f.path}`);
    }
  }
  return { root, manifest, cleanup };
}

/** Reads and verifies an archive, then throws the extracted copy away. */
export function readManifest(archive, passphrase, opts) {
  const { manifest, cleanup } = unpack(archive, passphrase, opts);
  rmSync(cleanup, { recursive: true, force: true });
  return { manifest };
}

/** Integrity, foreign keys and a row count per table. Throws on any problem. */
export function inspect(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
    const fk = db.pragma('foreign_key_check');
    if (fk.length) throw new Error(`foreign_key_check: ${fk.length} violation(s)`);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    const counts = Object.fromEntries(
      tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]),
    );
    const head = tables.includes('__drizzle_migrations')
      ? db.prepare('SELECT MAX(created_at) AS m FROM __drizzle_migrations').get().m
      : null;
    return { counts, schemaHead: head === null ? null : Number(head) };
  } finally {
    db.close();
  }
}
