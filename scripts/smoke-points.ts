/**
 * Points must be credited the moment somebody is put on the schedule.
 *
 * This is not a preference. The scheduler picks by fewest points, so if credit
 * lagged until after a shift was served, a second week drawn before the first
 * one ran would see an all-zero pool and could pick the same people twice in a
 * row. This proves the credit lands at generation, and that the draw always
 * takes from the people with fewest points.
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
import { addDays, todayInEastern, mondayOf } from '../src/lib/dates.ts';

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

async function totalPoints(): Promise<number> {
  const m = await db.select().from(members);
  return m.reduce((n, x) => n + x.points, 0);
}

async function main() {
  const existing = await db.select().from(weeks);
  if (existing.length === 0) throw new Error('post a week first');

  const latest = existing.map((w) => w.weekStart).sort().at(-1)!;
  let nextStart = addDays(latest, 7);
  const curMon = mondayOf(todayInEastern());
  if (nextStart <= curMon) {
    nextStart = addDays(curMon, 7);
  }

  const pointsBefore = await totalPoints();

  console.log(
    `\n${existing.length} week(s) already drawn, ${pointsBefore} points issued`,
  );
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

  console.log('\nfairness of the draw');

  // Not "nobody repeats". Once the low-point pool is used up, repeating is
  // correct and unavoidable: with ~94 eligible and ~33 seats a week, everybody
  // has been drawn by week three, so week four must reuse people. The real
  // guarantee is that the draw always takes from those with fewest points,
  // which shows up as a tight spread and as nobody being passed over.
  const after = await db.select().from(members);

  // Spread is reported, not asserted. A bounty deliberately pushes somebody
  // ahead - that is the whole point of awarding 3x - so a wide spread can be
  // entirely correct. The invariant that must hold is the one below: the draw
  // never passes over somebody with fewer points.
  for (const year of ['junior', 'sophomore'] as const) {
    const pool = after.filter((m) => m.classYear === year && !m.exempt && m.active);
    const pts = pool.map((m) => m.points);
    const bountied = pool.filter((m) => !Number.isInteger(m.points) || m.points > 1);
    console.log(
      `  ${year}: spread ${Math.max(...pts) - Math.min(...pts)}` +
        `, ${bountied.length} above a single normal shift`,
    );
  }

  const drawnIds = new Set(a2.map((x) => x.memberId));
  for (const year of ['junior', 'sophomore'] as const) {
    const pool = after.filter((m) => m.classYear === year && !m.exempt && m.active);
    const drawn = pool.filter((m) => drawnIds.has(m.id));
    const skipped = pool.filter((m) => !drawnIds.has(m.id));
    if (drawn.length === 0 || skipped.length === 0) continue;

    // Totals already include this week, so somebody drawn sits one point above
    // where they were when the choice was actually made.
    const worstDrawn = Math.max(...drawn.map((m) => m.points)) - 1;
    const bestSkipped = Math.min(...skipped.map((m) => m.points));
    check(`no ${year} was passed over for somebody with more points`, () =>
      assert.ok(
        worstDrawn <= bestSkipped,
        `drew somebody on ${worstDrawn} while somebody on ${bestSkipped} sat out`,
      ),
    );
  }

  const perPerson = new Map<string, number>();
  for (const x of a2) perPerson.set(x.memberId, (perPerson.get(x.memberId) ?? 0) + 1);
  check('nobody is drawn twice within the week', () =>
    assert.equal([...perPerson.values()].filter((n) => n > 1).length, 0),
  );

  console.log('\ncleanup');
  const d = await deleteWeek(r.week.id, 'points smoke');
  check('week removed', () => assert.ok(d.ok, d.message));

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
