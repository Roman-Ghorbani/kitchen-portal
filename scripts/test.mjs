#!/usr/bin/env node
/**
 * Runs the test suite against a throwaway database.
 *
 * Creates a fresh SQLite file in the OS temp directory, applies every
 * migration, seeds a semester and a demo roster, then runs `node --test` with
 * DATABASE_FILE pointing at it. The suite can therefore exercise real queries
 * - sign-in throttling, revocation, the audit filters - without ever opening
 * ./data/kitchen.db.
 *
 *   npm test
 *   npm test -- --test-name-pattern="throttle"
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dir = mkdtempSync(join(tmpdir(), 'kitchen-portal-test-'));
const file = join(dir, 'test.db');

const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
migrate(drizzle(sqlite), { migrationsFolder: 'drizzle' });
sqlite.close();

const env = {
  ...process.env,
  DATABASE_FILE: file,
  NODE_ENV: 'test',
  SESSION_SECRET: randomBytes(32).toString('hex'),
};

const node = process.execPath;
const seed = spawnSync(node, ['--experimental-strip-types', '--no-warnings', 'src/db/seed.ts', '--demo'], {
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});
if (seed.status !== 0) process.exit(seed.status ?? 1);

const result = spawnSync(
  node,
  [
    '--test',
    '--experimental-strip-types',
    '--no-warnings',
    // One file at a time: they share the database file.
    '--test-concurrency=1',
    ...process.argv.slice(2),
    'src/**/*.test.ts',
  ],
  { env, stdio: 'inherit' },
);

rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
