#!/usr/bin/env node
/**
 * Applies pending database migrations from ./drizzle.
 *
 *   npm run db:migrate
 *
 * Uses drizzle's runtime migrator rather than drizzle-kit, so it needs nothing
 * but the production dependencies and runs on the Pi's Node 20.
 */

import './load-env.mjs';

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const file = resolve(process.env.DATABASE_FILE ?? './data/kitchen.db');
if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });

const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
const before = sqlite.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get()
  ? sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get().n
  : 0;
migrate(drizzle(sqlite), { migrationsFolder: 'drizzle' });
const after = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get().n;
sqlite.close();

console.log(`[migrate] ${file}: ${after - before} migration(s) applied, ${after} total`);
