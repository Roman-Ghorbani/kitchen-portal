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
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../src/db/schema.ts';
import {
  unpublishWeek,
  republishWeek,
  deleteWeek,
  reassignShift,
  removeFromShift,
  addToShift,
} from '../src/lib/week-admin.ts';
import { chapterLockFor } from '../src/lib/dates.ts';

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
  const [week] = await db.select().from(weeks);
  if (!week) throw new Error('no weeks - post one first');

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

  /* ---------- week-level guards ---------- */
  console.log('\nweek-level');
  const wasPosted = week.status === 'posted';
  const started = week.weekStart <= new Date().toISOString().slice(0, 10);

  const unpub = await unpublishWeek(week.id, 'Smoke');
  if (started) {
    check('refuses to unpublish a week already running', () =>
      assert.ok(!unpub.ok),
    );
    check('says why', () => assert.match(unpub.message, /already started/));
  } else {
    check('unpublishes a future week', () => assert.ok(unpub.ok, unpub.message));

    const hidden = await db.select().from(weeks).where(eq(weeks.id, week.id));
    check('status is draft', () => assert.equal(hidden[0].status, 'draft'));
    check('lock deadline cleared', () => assert.equal(hidden[0].locksAt, null));

    if (wasPosted) {
      const re = await republishWeek(
        week.id,
        'Smoke',
        new Date(`${chapterLockFor(week.weekStart)}T23:59:59Z`),
      );
      check('reposts it', () => assert.ok(re.ok, re.message));
      const live = await db.select().from(weeks).where(eq(weeks.id, week.id));
      check('status is posted again', () => assert.equal(live[0].status, 'posted'));
      check('deadline restored before the week starts', () =>
        assert.ok(live[0].locksAt!.toISOString().slice(0, 10) < live[0].weekStart),
      );
    }
  }

  const del = await deleteWeek(week.id, 'Smoke');
  check('refuses to delete a posted week', () => assert.ok(!del.ok));

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
  check('no stray points', () =>
    assert.equal(dirty.filter((m) => m.points !== 0).length, 0),
  );
  check('no stray make-up debt', () =>
    assert.equal(dirty.filter((m) => m.makeupDebt !== 0).length, 0),
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
