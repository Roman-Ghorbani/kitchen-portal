/**
 * Points must be credited the moment somebody is put on the schedule.
 *
 * This is not a preference. The scheduler picks by fewest points, so if credit
 * lagged until after a shift was served, a second week drawn before the first
 * one ran would see an all-zero pool and could pick the same people twice in a
 * row. This script proves the credit lands at generation and that consecutive
 * weeks therefore draw different people.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/smoke-points.ts
 */

import { eq, inArray } from 'drizzle-orm';
import assert from 'node:assert/strict';

import { db } from '../src/db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../src/db/schema.ts';
import { generateAndSaveWeek } from '../src/lib/week-service.ts';
import { deleteWeek } from '../src/lib/week-admin.ts';
import { addDays } from '../src/lib/dates.ts';

const fails: string[] = [];
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (e) {
    fails.push(label);
    console.log(`  FAIL ${label}: ${(e as Error).message}`);
  }
}

async function peopleOnWeek(weekId: string): Promise<Set<string>> {
  const s = await db
    .select({ id: slotsTable.id })
    .from(slotsTable)
    .where(eq(slotsTable.weekId, weekId));
  if (s.length === 0) return new Set();
  const a = await db
    .select()
    .from(assignmentsTable)
    .where(
      inArray(
        assignmentsTable.slotId,
        s.map((x) => x.id),
      ),
    );
  return new Set(a.map((x) => x.coveredByMemberId ?? x.memberId));
}

async function totalPoints(): Promise<number> {
  const m = await db.select().from(members);
  return m.reduce((n, x) => n + x.points, 0);
}

async function main() {
  const existing = await db.select().from(weeks);
  if (existing.length === 0) throw new Error('post a week first');

  const latest = existing.map((w) => w.weekStart).sort().at(-1)!;
  const nextStart = addDays(latest, 7);

  const week1People = await peopleOnWeek(existing[0].id);
  const pointsBefore = await totalPoints();

  console.log(`\nexisting week uses ${week1People.size} people, ${pointsBefore} points issued`);
  console.log(`drawing ${nextStart}\n`);

  const r = await generateAndSaveWeek(nextStart, {});

  const slots2 = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.weekId, r.week.id));
  const a2 = await db
    .select()
    .from(assignmentsTable)
    .where(
      inArray(
        assignmentsTable.slotId,
        slots2.map((s) => s.id),
      ),
    );

  console.log('credit at generation');
  check('every new assignment is credited immediately', () =>
    assert.equal(a2.filter((x) => x.pointsAwarded > 0).length, a2.length),
  );
  check('each records who the credit went to', () =>
    assert.equal(a2.filter((x) => x.settledRecipientId !== null).length, a2.length),
  );
  check('each is stamped settled', () =>
    assert.equal(a2.filter((x) => x.settledAt !== null).length, a2.length),
  );

  const pointsAfter = await totalPoints();
  check('member totals rose by exactly the seats filled', () =>
    assert.equal(pointsAfter - pointsBefore, a2.length),
  );

  const withDate = await db.select().from(members);
  const scheduled = new Set(a2.map((x) => x.memberId));
  check('everyone drawn has a last-scheduled date for the tie-break', () =>
    assert.ok(
      [...scheduled].every(
        (id) => withDate.find((m) => m.id === id)!.lastServedDate !== null,
      ),
    ),
  );

  console.log('\nfairness across consecutive weeks');
  const week2People = await peopleOnWeek(r.week.id);
  const overlap = [...week2People].filter((id) => week1People.has(id));
  check('nobody is drawn two weeks running', () =>
    assert.equal(
      overlap.length,
      0,
      `${overlap.length} people repeated - credit is lagging behind scheduling`,
    ),
  );

  const perPerson = new Map<string, number>();
  for (const x of a2) perPerson.set(x.memberId, (perPerson.get(x.memberId) ?? 0) + 1);
  check('nobody is drawn twice within the week', () =>
    assert.equal([...perPerson.values()].filter((n) => n > 1).length, 0),
  );

  console.log('\ncleanup');
  await db.update(weeks).set({ status: 'draft' }).where(eq(weeks.id, r.week.id));
  const d = await deleteWeek(r.week.id, 'points smoke');
  check('draft week removed', () => assert.ok(d.ok, d.message));

  const restored = await totalPoints();
  check('deleting the week gives the points back', () =>
    assert.equal(restored, pointsBefore),
  );

  await db.delete(events).where(eq(events.actorName, 'points smoke'));

  console.log(
    fails.length === 0
      ? '\nALL CHECKS PASSED'
      : `\n${fails.length} FAILED: ${fails.join(', ')}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke error:', e);
  process.exit(1);
});
