// scripts/migrate.js
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';

try {
  console.log('Opening database...');
  const sqlite = new Database(resolve('./data/kitchen.db'));
  const db = drizzle(sqlite);
  
  console.log('Applying migrations...');
  migrate(db, { migrationsFolder: resolve('./drizzle') });
  
  console.log('Migrations applied successfully!');
  sqlite.close();
} catch (err) {
  console.error('Migration failed:', err);
}
