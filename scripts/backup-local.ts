/**
 * Pulls a consistent snapshot of the database to a local file.
 *
 * Uses SQLite's own backup API rather than copying the file: a plain copy can
 * catch the database mid-write and produce something that will not open.
 *
 *   npm run db:backup            -> ./backups/kitchen-YYYY-MM-DD-HHMM.db
 *   npm run db:backup -- /path   -> somewhere else
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import Database from 'better-sqlite3';

const source = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');

if (!existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .slice(0, 16)
  .replace(/[:T]/g, '-');

const target = resolve(process.argv[2] ?? `./backups/kitchen-${stamp}.db`);
mkdirSync(dirname(target), { recursive: true });

const db = new Database(source, { readonly: true });
await db.backup(target);
db.close();

const size = statSync(target).size;

// A backup nobody has opened is a guess. Prove it reads before reporting.
const check = new Database(target, { readonly: true });
const counts = {
  members: check.prepare('SELECT COUNT(*) n FROM members').get() as { n: number },
  assignments: check.prepare('SELECT COUNT(*) n FROM assignments').get() as {
    n: number;
  },
  events: check.prepare('SELECT COUNT(*) n FROM events').get() as { n: number },
};
check.close();

console.log(`backed up to ${target}`);
console.log(`  ${(size / 1024).toFixed(0)} KB`);
console.log(
  `  verified: ${counts.members.n} members, ` +
    `${counts.assignments.n} assignments, ${counts.events.n} logged events`,
);
