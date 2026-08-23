/**
 * Database client (SQLite via better-sqlite3).
 *
 * The whole database is one file on the same machine as the app, so a query
 * costs microseconds rather than a network round trip. That matters here: this
 * codebase deliberately favours several small, readable queries over one
 * clever one, and rendering the schedule board takes about five of them while
 * settling a full week takes closer to two hundred. Against a remote database
 * that arithmetic forces you to write worse code.
 *
 * WAL mode lets readers carry on while a write is in progress, which is what
 * makes this comfortable for a few dozen people refreshing at once.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.ts';

const file = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');

const dir = dirname(file);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(file);

// Concurrent readers during a write, rather than the whole file locking.
sqlite.pragma('journal_mode = WAL');
// Wait rather than failing instantly if a write is briefly in progress.
sqlite.pragma('busy_timeout = 5000');
// Referential integrity is off by default in SQLite, which surprises people.
sqlite.pragma('foreign_keys = ON');
// Durable enough for this, and much faster than full fsync on every commit.
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
