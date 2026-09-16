/**
 * The cover-request rule, end to end.
 *
 * Asking for cover posts the seat to the whole house, but does NOT release the
 * brother who asked. The point stays with him until somebody actually takes
 * it; if nobody does and he is marked absent, he owes a make-up exactly as if
 * he had never asked. Without that, a request five minutes before service
 * costs nothing and the kitchen goes uncleaned.
 *
 * Draws a throwaway future week, exercises the whole chain against it, then
 * deletes the week and checks the points it issued were handed back.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/smoke-cover-request.ts
 */

import { eq, sql } from 'drizzle-orm';
import assert from 'node:assert/strict';

import { db } from '../src/db/index.ts';
import {
  members,
  assignments as assignmentsTable,
  slots as slotsTable,
} from '../src/db/schema.ts';
import {
  flagConflict,
  volunteerToCover,
  setAttendance,
} from '../src/lib/shift-service.ts';
import { generateAndSaveWeek } from '../src/lib/week-service.ts';
import { deleteWeek } from '../src/lib/week-admin.ts';
import { mondayOf, addDays, todayInEastern } from '../src/lib/dates.ts';

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

const pointsOf = async (id: string) =>
  (await db.select({ p: members.points }).from(members).where(eq(members.id, id)))[0].p;
const debtOf = async (id: string) =>
  (await db.select({ d: members.makeupDebt }).from(members).where(eq(members.id, id)))[0].d;
const totalPoints = async () =>
  (await db.select({ t: sql<number>`sum(${members.points})` }).from(members))[0].t ?? 0;

async function main() {
  // A week starting next Monday, so every slot is comfortably in the future and
  // the "you cannot pick up a day that has passed" guard stays out of it.
  const weekStart = addDays(mondayOf(todayInEastern()), 7);
  const pointsBefore = await totalPoints();
  console.log(`\ndrawing throwaway week of ${weekStart}`);

  const { week } = await generateAndSaveWeek(weekStart, { post: true });

  const rows = await db
    .select({
      id: assignmentsTable.id,
      slotId: assignmentsTable.slotId,
      memberId: assignmentsTable.memberId,
      date: slotsTable.date,
      meal: slotsTable.meal,
    })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .where(eq(slotsTable.weekId, week.id));

  assert.ok(rows.length > 2, 'the throwaway week produced too few assignments');

  /* ---------------- asked for, then taken ---------------- */

  const target = rows[0];
  const owner = target.memberId;
  // Anyone may cover any shift whatever their year, but they cannot already be
  // on this one - so take somebody rostered on a different slot entirely.
  const helper = rows.find(
    (r) => r.slotId !== target.slotId && r.memberId !== owner,
  );
  assert.ok(helper, 'no brother free to cover');
  const volunteer = helper.memberId;

  const ownerStart = await pointsOf(owner);
  const volunteerStart = await pointsOf(volunteer);

  console.log('\nasking for cover');
  const asked = await flagConflict(target.id, owner, 'smoke test');
  check('a brother can ask with no window to be inside of', () =>
    assert.ok(asked.ok, asked.message),
  );

  const ownerAfterAsk = await pointsOf(owner);
  const debtAfterAsk = await debtOf(owner);
  check('asking does not take his point away', () =>
    assert.equal(ownerAfterAsk, ownerStart, `${ownerStart} -> ${ownerAfterAsk}`),
  );
  check('asking earns him no make-up debt', () => assert.equal(debtAfterAsk, 0));

  console.log('\nsomebody takes it');
  const took = await volunteerToCover(target.id, volunteer);
  check('anyone can claim it', () => assert.ok(took.ok, took.message));

  const ownerAfterCover = await pointsOf(owner);
  const volunteerAfterCover = await pointsOf(volunteer);
  check('only then does the point leave the man who asked', () =>
    assert.ok(ownerAfterCover < ownerStart, `${ownerStart} -> ${ownerAfterCover}`),
  );
  check('and it lands on whoever covered', () =>
    assert.ok(
      volunteerAfterCover > volunteerStart,
      `${volunteerStart} -> ${volunteerAfterCover}`,
    ),
  );

  /* ---------------- asked for, nobody took it ---------------- */

  console.log('\nnobody takes it and he does not serve');
  const second = rows.find(
    (r) => r.slotId !== target.slotId && r.memberId !== volunteer && r.memberId !== owner,
  );
  assert.ok(second, 'no second shift to test the unclaimed path with');
  const loner = second.memberId;
  const lonerStart = await pointsOf(loner);
  const lonerDebtStart = await debtOf(loner);

  await flagConflict(second.id, loner, 'smoke test, nobody takes it');
  const lonerAfterAsk = await pointsOf(loner);
  check('an unclaimed request leaves his point exactly where it was', () =>
    assert.equal(lonerAfterAsk, lonerStart, `${lonerStart} -> ${lonerAfterAsk}`),
  );

  const absent = await setAttendance(second.id, 'no-show', 'cover smoke');
  check('he can still be marked absent after asking', () =>
    assert.ok(absent.ok, absent.message),
  );

  const lonerAfterAbsent = await pointsOf(loner);
  const lonerDebtAfter = await debtOf(loner);
  check('a no-show still costs him the point', () =>
    assert.ok(
      lonerAfterAbsent < lonerStart,
      `${lonerStart} -> ${lonerAfterAbsent}`,
    ),
  );
  check('and still owes a make-up, exactly as if he had never asked', () =>
    assert.ok(
      lonerDebtAfter > lonerDebtStart,
      `${lonerDebtStart} -> ${lonerDebtAfter}`,
    ),
  );

  /* ---------------- cleanup ---------------- */

  console.log('\ncleanup');
  const removed = await deleteWeek(week.id, 'cover request smoke');
  check('throwaway week removed', () => assert.ok(removed.ok, removed.message));

  const pointsAfter = await totalPoints();
  check('deleting it hands every point back', () =>
    assert.equal(pointsAfter, pointsBefore, `${pointsBefore} -> ${pointsAfter}`),
  );

  const debtLeft = await debtOf(loner);
  check('and clears the debt the throwaway no-show created', () =>
    assert.equal(debtLeft, lonerDebtStart, `${lonerDebtStart} -> ${debtLeft}`),
  );

  console.log(
    fails.length === 0
      ? '\nall cover-request checks passed\n'
      : `\n${fails.length} check(s) failed\n`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nsmoke error:', e);
  process.exit(1);
});
