/**
 * Exercises the admin overrides against the real database, then restores
 * everything. Checks the guards as well as the happy paths, because the
 * guards are the part that protects the record.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/smoke-week-admin.ts
 */

import { eq, inArray } from 'drizzle-orm';
import assert from 'node:assert/strict';

import { db } from '../src/db/index.ts';
import { generateAndSaveWeek } from '../src/lib/week-service.ts';
import { addDays } from '../src/lib/dates.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../src/db/schema.ts';
import {
  lockWeek,
  unlockWeek,
  deleteWeek,
  reassignShift,
  removeFromShift,
  addToShift,
} from '../src/lib/week-admin.ts';

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

async function main() {
  const allWeeks = await db.select().from(weeks);
  if (allWeeks.length === 0) throw new Error('no weeks - create one first');
  const week = allWeeks[0];

  const slotRows = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.weekId, week.id));

  const lunchSlots = slotRows.filter((s) => s.meal === 'lunch').sort((x, y) => x.date.localeCompare(y.date));
  const lunch = lunchSlots[0];
  const dinner = slotRows.find((s) => s.meal === 'dinner')!;
  void dinner;

  const lunchAsg = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, lunch.id));
  const dinnerAsg = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, dinner.id));

  const roster = await db.select().from(members);
  const onLunch = new Set(lunchAsg.map((a) => a.memberId));

  // Scheduled people hold points at rest, so assert the total is unchanged
  // rather than that it is zero.
  const pointsBefore = roster.reduce((n, m) => n + m.points, 0);
  const debtBefore = roster.reduce((n, m) => n + m.makeupDebt, 0);

  const spareJunior = roster.find(
    (m) => m.active && m.classYear === 'junior' && !onLunch.has(m.id),
  )!;
  const aSophomore = roster.find((m) => m.active && m.classYear === 'sophomore')!;

  const target = lunchAsg[0];
  const originalMemberId = target.memberId;
  const originalName = roster.find((m) => m.id === originalMemberId)!.name;

  console.log(`\nweek ${week.weekStart} (${week.status}), lunch ${lunch.date}`);
  console.log(`target: ${originalName} -> ${spareJunior.name}\n`);

  /* ---------- reassign ---------- */
  console.log('reassign');
  const wrongYear = await reassignShift(target.id, aSophomore.id, 'Smoke', {});
  check('rejects wrong class year by default', () => assert.ok(!wrongYear.ok));
  check('explains why', () => assert.match(wrongYear.message, /sophomore/));

  const forced = await reassignShift(target.id, aSophomore.id, 'Smoke', {
    allowAnyClassYear: true,
  });
  check('allows wrong year when explicitly overridden', () =>
    assert.ok(forced.ok, forced.message),
  );

  const back = await reassignShift(target.id, spareJunior.id, 'Smoke', {});
  check('reassigns to a valid junior', () => assert.ok(back.ok, back.message));

  const after = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, target.id));
  check('the row now names the new person', () =>
    assert.equal(after[0].memberId, spareJunior.id),
  );
  check('reassign is a clean replace, not a coverage', () =>
    assert.equal(after[0].coveredByMemberId, null),
  );

  const dupe = await reassignShift(target.id, spareJunior.id, 'Smoke', {});
  check('refuses to reassign to who is already on it', () => assert.ok(!dupe.ok));

  /* ---------- remove and add ---------- */
  console.log('\nremove and add');
  const removed = await removeFromShift(target.id, 'Smoke');
  check('removes somebody from a shift', () => assert.ok(removed.ok));

  const nowOn = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, lunch.id));
  check('the seat is now open', () => assert.equal(nowOn.length, lunch.size - 1));

  const wrongAdd = await addToShift(lunch.id, aSophomore.id, 'Smoke', {});
  check('add rejects wrong class year by default', () => assert.ok(!wrongAdd.ok));

  const added = await addToShift(lunch.id, originalMemberId, 'Smoke', {});
  check('adds the original person back', () => assert.ok(added.ok, added.message));

  const full = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, lunch.id));
  check('slot is full again', () => assert.equal(full.length, lunch.size));

  const overfill = await addToShift(lunch.id, spareJunior.id, 'Smoke', {});
  check('refuses to overfill a full slot', () => assert.ok(!overfill.ok));

  /* ---------- week-level ---------- */
  console.log('\nweek-level');

  // Lock and unlock the real week - both are reversible.
  const locked = await lockWeek(week.id, 'Smoke');
  check('locks the week', () => assert.ok(locked.ok, locked.message));
  const afterLock = await db.select().from(weeks).where(eq(weeks.id, week.id));
  check('status is locked', () => assert.equal(afterLock[0].status, 'locked'));
  check('lock time recorded', () => assert.ok(afterLock[0].lockedAt !== null));

  const unlocked = await unlockWeek(week.id, 'Smoke');
  check('unlocks it again', () => assert.ok(unlocked.ok, unlocked.message));
  const afterUnlock = await db.select().from(weeks).where(eq(weeks.id, week.id));
  check('status is open', () => assert.equal(afterUnlock[0].status, 'posted'));

  // Deletion is tested on a week this script creates, never on a real one.
  // An earlier version of this test deleted whichever week it found first and
  // destroyed a posted schedule.
  const throwawayStart = addDays(
    allWeeks.map((w) => w.weekStart).sort().at(-1)!,
    7,
  );
  const throwaway = await generateAndSaveWeek(throwawayStart);
  check('created a throwaway week to test deletion on', () =>
    assert.ok(throwaway.week.id),
  );

  const del = await deleteWeek(throwaway.week.id, 'Smoke');
  check('a future week can be deleted', () => assert.ok(del.ok, del.message));
  const gone = await db
    .select()
    .from(weeks)
    .where(eq(weeks.id, throwaway.week.id));
  check('it is actually gone', () => assert.equal(gone.length, 0));

  const startedWeek = allWeeks.find(
    (w) => w.weekStart <= new Date().toISOString().slice(0, 10),
  );
  if (startedWeek) {
    const refused = await deleteWeek(startedWeek.id, 'Smoke');
    check('refuses to delete a week already running', () =>
      assert.ok(!refused.ok),
    );
    check('says why', () => assert.match(refused.message, /already started/));
  }

  /* ---------- audit ---------- */
  const log = await db.select().from(events);
  const actions = new Set(log.map((e) => e.action));
  for (const a of [
    'shift.reassigned',
    'shift.removed',
    'shift.added',
  ]) {
    check(`logged ${a}`, () => assert.ok(actions.has(a), `missing ${a}`));
  }

  /* ---------- restore ---------- */
  console.log('\nrestoring');
  await db.delete(events).where(inArray(events.actorName, ['Smoke']));

  const finalAsg = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, lunch.id));
  check('lunch slot back to full size', () =>
    assert.equal(finalAsg.length, lunch.size),
  );

  // Points were never settled for a future week, but make sure of it.
  const dirty = await db.select().from(members);
  check('points back to the starting total', () =>
    assert.equal(dirty.reduce((n, m) => n + m.points, 0), pointsBefore),
  );
  check('make-up debt back to the starting total', () =>
    assert.equal(dirty.reduce((n, m) => n + m.makeupDebt, 0), debtBefore),
  );

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
