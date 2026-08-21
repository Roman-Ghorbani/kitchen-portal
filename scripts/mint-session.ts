/**
 * Dev helper: mints signed session cookies so pages can be exercised with
 * curl without going through the sign-in UI. Never used in production - it
 * needs SESSION_SECRET, which only exists locally and in Vercel's env.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/mint-session.ts <output-file>
 */

import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';

import { signSession } from '../src/lib/auth.ts';
import { db } from '../src/db/index.ts';
import * as S from '../src/db/schema.ts';

const out = process.argv[2];
if (!out) {
  console.error('usage: mint-session.ts <output-file>');
  process.exit(1);
}

const admin = signSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager' });

const asg = await db.select().from(S.assignments);
if (asg.length === 0) {
  console.error('no assignments exist - post a week first');
  process.exit(1);
}

const [m] = await db
  .select()
  .from(S.members)
  .where(eq(S.members.id, asg[0].memberId));

const bro = signSession({ sub: m.id, role: 'brother', name: m.name });

writeFileSync(out, `admin=${admin}\nbro=${bro}\nname=${m.name}\nid=${m.id}\n`);
console.log('wrote sessions for admin and', m.name);
process.exit(0);
