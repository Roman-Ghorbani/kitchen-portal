/**
 * Database client.
 *
 * Currently on Neon over HTTP, which suits Vercel's serverless functions
 * (no persistent connection pool to manage).
 *
 * MOVING TO A DROPLET LATER: Neon is ordinary Postgres, so the migration is
 * contained to this file. Replace the neon/drizzle imports below with:
 *
 *   import { Pool } from 'pg';
 *   import { drizzle } from 'drizzle-orm/node-postgres';
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   export const db = drizzle(pool, { schema });
 *
 * The retry wiring can go at the same time - a droplet's Postgres does not
 * suspend, so there is no cold start to absorb.
 */

import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';
import { makeRetryingFetch } from './retry-fetch.ts';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and paste your ' +
      'Neon connection string into it.',
  );
}

/**
 * Absorbs Neon's free-tier cold start. See retry-fetch.ts for why this matters
 * here specifically.
 *
 * `fetchFunction` is global-only on this driver: the neon() constructor
 * destructures a fixed set of options and silently drops this one if it is
 * passed per-client, so it has to be set on neonConfig to take effect.
 */
neonConfig.fetchFunction = makeRetryingFetch(fetch);

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
export { schema };
