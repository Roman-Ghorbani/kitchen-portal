/**
 * End-to-end check of the shift mechanic against the real database.
 *
 * Exercises flag -> cover -> settle -> correct to no-show -> undo, asserting
 * points and make-up debt at every step, then restores the original state so
 * it is safe to run against live data.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/smoke-shift-flow.ts
 */

import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';

import { db } from '../src/db/index.ts';
import {
  members,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../src/db/schema.ts';
import {
  flagConflict,
  volunteerToCover,
  setAttendance,
  assignSubstitute,
  settleAssignment,
  getOpenShifts,
} from '../src/lib/shift-service.ts';

const fail: string[] = [];
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (e) {
    fail.push(label);
    console.log(`  FAIL ${label}: ${(e as Error).message}`);
  }
}

async function pointsOf(id: string) {
  const [m] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return { points: m.points, debt: m.makeupDebt, name: m.name };
}

async function main() {
  // Pick a real assignment and a volunteer who is not already on that slot.
  const [a] = await db.select().from(assignmentsTable).limit(1);
  if (!a) throw new Error('no assignments - post a week first');

  const [slot] = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, a.slotId))
    .limit(1);

  const onSlot = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, a.slotId));
  const onSlotIds = new Set(onSlot.map((x) => x.memberId));

  const roster = await db.select().from(members);
  const volunteer = roster.find((m) => m.active && !onSlotIds.has(m.id))!;

  const assignee = await pointsOf(a.memberId);
  const vol0 = await pointsOf(volunteer.id);

  console.log(`\nassignment: ${assignee.name} on ${slot.meal} ${slot.date}`);
  console.log(`volunteer:  ${volunteer.name}\n`);

  const eventsBefore = (await db.select().from(events)).length;

  /* ---------- flag ---------- */
  console.log('flag a conflict');
  const f1 = await flagConflict(a.id, a.memberId, 'smoke test');
  check('flagging succeeds', () => assert.ok(f1.ok, f1.message));

  const f2 = await flagConflict(a.id, a.memberId, 'again');
  check('double-flagging is rejected', () => assert.ok(!f2.ok));

  const wrongPerson = await flagConflict(a.id, volunteer.id, 'not mine');
  check('cannot flag somebody else shift', () => assert.ok(!wrongPerson.ok));

  const open = await getOpenShifts();
  check('shift appears in the open list', () =>
    assert.ok(open.some((o) => o.assignmentId === a.id)),
  );

  /* ---------- cover ---------- */
  console.log('\nvolunteer covers it');
  const c1 = await volunteerToCover(a.id, volunteer.id);
  check('covering succeeds', () => assert.ok(c1.ok, c1.message));

  const c2 = await volunteerToCover(a.id, volunteer.id);
  check('second claim loses the race', () => assert.ok(!c2.ok));

  await settleAssignment(a.id);
  let vol = await pointsOf(volunteer.id);
  let asg = await pointsOf(a.memberId);
  check('coverer earns the point', () =>
    assert.equal(vol.points, vol0.points + 1),
  );
  check('original member earns nothing', () =>
    assert.equal(asg.points, assignee.points),
  );
  check('original member owes no debt for being covered', () =>
    assert.equal(asg.debt, assignee.debt),
  );

  /* ---------- settle twice ---------- */
  await settleAssignment(a.id);
  vol = await pointsOf(volunteer.id);
  check('re-settling does not double-credit', () =>
    assert.equal(vol.points, vol0.points + 1),
  );

  /* ---------- bounty ---------- */
  console.log('\nraise the bounty to 3x');
  const b = await assignSubstitute(a.id, volunteer.id, 3, 'Smoke Test');
  check('bounty applies', () => assert.ok(b.ok, b.message));
  vol = await pointsOf(volunteer.id);
  check('coverer now holds 3 points for the shift', () =>
    assert.equal(vol.points, vol0.points + 3),
  );

  /* ---------- no-show ---------- */
  console.log('\nmark it a no-show after the fact');
  const n = await setAttendance(a.id, 'no-show', 'Smoke Test');
  check('marking no-show succeeds', () => assert.ok(n.ok, n.message));

  vol = await pointsOf(volunteer.id);
  asg = await pointsOf(a.memberId);
  check('the 3 points are clawed back', () =>
    assert.equal(vol.points, vol0.points),
  );
  check('assignee owes one make-up', () =>
    assert.equal(asg.debt, assignee.debt + 1),
  );

  /* ---------- undo ---------- */
  console.log('\nundo back to present');
  await db
    .update(assignmentsTable)
    .set({ coveredByMemberId: null, multiplier: 1 })
    .where(eq(assignmentsTable.id, a.id));
  const u = await setAttendance(a.id, 'assigned', 'Smoke Test');
  check('undo succeeds', () => assert.ok(u.ok, u.message));

  vol = await pointsOf(volunteer.id);
  asg = await pointsOf(a.memberId);
  check('debt is cleared', () => assert.equal(asg.debt, assignee.debt));
  check('assignee holds the point', () =>
    assert.equal(asg.points, assignee.points + 1),
  );
  check('volunteer is back to where he started', () =>
    assert.equal(vol.points, vol0.points),
  );

  /* ---------- audit ---------- */
  const eventsAfter = await db.select().from(events);
  check('every step was written to the audit log', () =>
    assert.ok(eventsAfter.length >= eventsBefore + 5,
      `expected >=${eventsBefore + 5} events, got ${eventsAfter.length}`),
  );

  /* ---------- restore ---------- */
  console.log('\nrestoring original state');
  await db
    .update(assignmentsTable)
    .set({
      status: 'assigned',
      coveredByMemberId: null,
      multiplier: 1,
      pointsAwarded: 0,
      debtAwarded: 0,
      settledRecipientId: null,
      settledAt: null,
    })
    .where(eq(assignmentsTable.id, a.id));

  await db
    .update(members)
    .set({ points: assignee.points, makeupDebt: assignee.debt, lastServedDate: null })
    .where(eq(members.id, a.memberId));
  await db
    .update(members)
    .set({ points: vol0.points, makeupDebt: vol0.debt, lastServedDate: null })
    .where(eq(members.id, volunteer.id));

  await db.delete(events).where(eq(events.action, 'shift.flagged'));
  await db.delete(events).where(eq(events.action, 'shift.covered'));
  await db.delete(events).where(eq(events.action, 'shift.substituted'));
  await db.delete(events).where(eq(events.action, 'attendance.no-show'));
  await db.delete(events).where(eq(events.action, 'attendance.assigned'));

  const finalA = await pointsOf(a.memberId);
  const finalV = await pointsOf(volunteer.id);
  check('assignee restored', () => assert.equal(finalA.points, assignee.points));
  check('volunteer restored', () => assert.equal(finalV.points, vol0.points));

  console.log(
    fail.length === 0
      ? '\nALL CHECKS PASSED'
      : `\n${fail.length} CHECK(S) FAILED: ${fail.join(', ')}`,
  );
  process.exit(fail.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke test error:', e);
  process.exit(1);
});
