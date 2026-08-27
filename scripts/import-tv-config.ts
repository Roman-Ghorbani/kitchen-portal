import * as fs from 'fs';
import * as path from 'path';
import { db } from '../src/db/index.ts';
import { tvSettings } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npx tsx scripts/import-tv-config.ts <path-to-announcements.json>');
    process.exit(1);
  }

  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON:', err);
    process.exit(1);
  }

  const existing = await db.select().from(tvSettings).limit(1);
  if (existing.length === 0) {
    await db.insert(tvSettings).values({ config });
    console.log('Successfully created TV settings from imported config!');
  } else {
    await db.update(tvSettings).set({ config, updatedAt: new Date() }).where(eq(tvSettings.id, existing[0].id));
    console.log('Successfully updated existing TV settings with imported config!');
  }
}

main().catch(console.error);
