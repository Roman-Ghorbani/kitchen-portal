/**
 * Imports the house contact CSV into the members table.
 *
 * Dry run by default - prints what it would do and changes nothing. Pass
 * --commit to actually write.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     src/db/import-roster.ts "C:/path/to/roster.csv"
 *
 *   ... --commit          write the roster
 *   ... --replace         clear the existing roster first (refused if the
 *                         schedule has already been used - see below)
 *   ... --exempt "Name"   mark someone exempt on import (repeatable)
 *   ... --junior "Name"   force class year, for brothers who rushed a year
 *   ... --sophomore "Name"  late and so do not match their pledge class
 *
 * The CSV is read from wherever you point it and is never copied into the
 * repo: it carries 133 people's phone numbers and email addresses, none of
 * which this app has any use for. Only name and class year are imported.
 */

import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';

import { db } from './index.ts';
import { members, assignments, events } from './schema.ts';
import { parseRosterCsv, type ImportOptions } from '../lib/roster-csv.ts';
import type { ClassYear } from '../lib/types.ts';

function argValues(flag: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

async function main() {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) {
    console.error('usage: import-roster.ts <path-to-csv> [--commit] [--replace]');
    process.exit(1);
  }

  const commit = process.argv.includes('--commit');
  const replace = process.argv.includes('--replace');

  const overrides: Record<string, ClassYear> = {};
  for (const n of argValues('--junior')) overrides[n] = 'junior';
  for (const n of argValues('--sophomore')) overrides[n] = 'sophomore';
  const exemptNames = new Set(argValues('--exempt').map((n) => n.toLowerCase()));

  const text = readFileSync(path, 'utf8');
  const result = parseRosterCsv(text, { overrides } satisfies ImportOptions);

  /* ---------------- report ---------------- */

  const juniors = result.members.filter((m) => m.classYear === 'junior');
  const sophomores = result.members.filter((m) => m.classYear === 'sophomore');

  console.log(`parsed ${path}`);
  console.log(
    `  on duty: ${result.members.length} ` +
      `(${juniors.length} juniors/lunch, ${sophomores.length} sophomores/dinner)`,
  );
  console.log(`  excluded: ${result.excluded.length}`);

  const byReason = new Map<string, number>();
  for (const e of result.excluded) {
    const key = e.reason.replace(/\(.*\)/, '').trim();
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of byReason) console.log(`      ${n} ${reason}`);

  if (result.appliedOverrides.length > 0) {
    console.log('  class year overrides applied:');
    for (const o of result.appliedOverrides) {
      console.log(`      ${o.name}: ${o.from} -> ${o.to}`);
    }
  }

  if (result.unmatchedOverrides.length > 0) {
    console.log('  !! overrides that matched NOBODY (check spelling):');
    for (const n of result.unmatchedOverrides) console.log(`      "${n}"`);
  }

  if (result.problems.length > 0) {
    console.log('  problems:');
    for (const p of result.problems) console.log(`      row ${p.row}: ${p.reason}`);
  }

  const unmatchedExempt = [...exemptNames].filter(
    (n) => !result.members.some((m) => m.name.toLowerCase() === n),
  );
  if (unmatchedExempt.length > 0) {
    console.log('  !! --exempt names matching nobody:', unmatchedExempt.join(', '));
  }

  if (!commit) {
    console.log('\ndry run - nothing written. Pass --commit to apply.');
    return;
  }

  /* ---------------- safety ---------------- */

  const [{ count: assignmentCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assignments);

  if (replace && assignmentCount > 0) {
    console.error(
      `\nREFUSING to --replace: ${assignmentCount} assignments already exist. ` +
        'Wiping the roster would orphan real schedule history. Edit the roster ' +
        'in the admin page instead.',
    );
    process.exit(1);
  }

  /* ---------------- write ---------------- */

  if (replace) {
    const removed = await db.delete(members).returning({ id: members.id });
    console.log(`\ncleared ${removed.length} existing members`);
  }

  const rows = result.members.map((m) => ({
    name: m.name,
    classYear: m.classYear,
    exempt: exemptNames.has(m.name.toLowerCase()),
    exemptReason: exemptNames.has(m.name.toLowerCase())
      ? ('officer' as const)
      : undefined,
  }));

  const inserted = await db.insert(members).values(rows).returning({
    id: members.id,
    name: members.name,
  });

  await db.insert(events).values({
    action: 'roster.imported',
    entityType: 'roster',
    actorName: 'import script',
    summary: `Imported ${inserted.length} members from CSV`,
    payload: {
      onDuty: inserted.length,
      juniors: juniors.length,
      sophomores: sophomores.length,
      excluded: result.excluded.length,
      overrides: result.appliedOverrides,
      exempt: [...exemptNames],
    },
  });

  console.log(`inserted ${inserted.length} members`);
  const exemptCount = rows.filter((r) => r.exempt).length;
  if (exemptCount > 0) console.log(`  ${exemptCount} marked exempt`);
  console.log('wrote roster.imported to the audit log');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('import failed:', err.message);
    process.exit(1);
  },
);
