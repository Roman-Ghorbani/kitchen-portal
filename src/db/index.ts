/**
 * Database client.
 *
 * Currently on Neon over HTTP, which suits Vercel's serverless functions
 * (no persistent connection pool to manage).
 *
 * MOVING TO A DROPLET LATER: Neon is ordinary Postgres, so the migration is
 * contained to this file. Replace the two imports below with:
 *
 *   import { Pool } from 'pg';
 *   import { drizzle } from 'drizzle-orm/node-postgres';
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   export const db = drizzle(pool, { schema });
 *
 * Nothing else in the app changes - queries, schema, and migrations are all
 * host-agnostic.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and paste your ' +
      'Neon connection string into it.',
  );
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
export { schema };
