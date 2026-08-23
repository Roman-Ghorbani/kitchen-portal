/**
 * The manager opens a shift to the house with a bounty, and somebody takes it.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/smoke-cover-offer.ts
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
  openForCover,
  setSlotBounty,
  claimOpenSeat,
  volunteerToCover,
  settleAssignment,
  unsettleAssignment,
} from '../src/lib/shift-service.ts';
import { removeFromShift } from '../src/lib/week-admin.ts';
import { getMyShifts } from '../src/lib/member-queries.ts';

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

async function pointsOf(id: string) {
  const [m] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return m.points;
}

async function main() {
  const [target] = await db.select().from(assignmentsTable).limit(1);
  const [slot] = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, target.slotId));

  const roster = await db.select().from(members);
  const owner = roster.find((m) => m.id === target.memberId)!;
  const onSlot = new Set(
    (await db.select().from(assignmentsTable).where(eq(assignmentsTable.slotId, slot.id)))
      .map((a) => a.memberId),
  );
  const taker = roster.find((m) => m.active && !onSlot.has(m.id))!;
  const second = roster.find((m) => m.active && !onSlot.has(m.id) && m.id !== taker.id)!;

  const ownerStart = await pointsOf(owner.id);
  const takerStart = await pointsOf(taker.id);
  const pointsStart = roster.reduce((n, m) => n + m.points, 0);

  console.log(`\n${owner.name}'s ${slot.meal} on ${slot.date}`);
  console.log(`offering it to ${taker.name}\n`);

  /* ---------- open it with a bounty ---------- */
  console.log('manager asks for cover at 2x');
  const bad = await openForCover(target.id, 2.5, 'Roman', null);
  check('rejects a multiplier outside the allowed set', () => assert.ok(!bad.ok));

  const opened = await openForCover(target.id, 2, 'Roman', 'told me he has a game');
  check('opens the shift', () => assert.ok(opened.ok, opened.message));

  const [afterOpen] = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, target.id));
  check('it now reads as needing cover', () =>
    assert.equal(afterOpen.status, 'flagged'),
  );
  check('the offer is recorded on the shift', () =>
    assert.equal(afterOpen.multiplier, 2),
  );
  check('the original loses the provisional point', () =>
    assert.equal(afterOpen.pointsAwarded, 0),
  );
  check('and it comes off his total', async () => {
    assert.equal(afterOpen.settledRecipientId, null);
  });

  const ownerNow = await pointsOf(owner.id);
  check('his total drops by the point he was holding', () =>
    assert.equal(ownerNow, ownerStart - 1),
  );
  check('he owes no make-up for it', async () => {
    const [m] = await db.select().from(members).where(eq(members.id, owner.id));
    assert.equal(m.makeupDebt, 0);
  });

  /* ---------- somebody takes it ---------- */
  console.log('\nsomebody takes it');
  const took = await volunteerToCover(target.id, taker.id);
  check('the shift can be claimed', () => assert.ok(took.ok, took.message));

  const takerNow = await pointsOf(taker.id);
  check('the taker earns the full 2x, not 1', () =>
    assert.equal(takerNow, takerStart + 2),
  );

  const takerShifts = await getMyShifts(taker.id);
  const picked = takerShifts.find((s) => s.assignmentId === target.id);
  check('it appears on their My Shifts', () => assert.ok(picked));
  check('marked as covering', () => assert.equal(picked!.role, 'covering'));
  check('showing what it is worth', () => assert.equal(picked!.multiplier, 2));

  /* ---------- an empty seat ---------- */
  console.log('\nan empty seat with an offer');
  await unsettleAssignment(target.id);
  await db
    .update(assignmentsTable)
    .set({ status: 'assigned', coveredByMemberId: null, multiplier: 1 })
    .where(eq(assignmentsTable.id, target.id));
  await settleAssignment(target.id);

  const removed = await removeFromShift(target.id, 'Roman');
  check('manager empties a seat', () => assert.ok(removed.ok));

  const offer = await setSlotBounty(slot.id, 3, 'Roman');
  check('offers 3x for it', () => assert.ok(offer.ok, offer.message));

  const claimed = await claimOpenSeat(slot.id, taker.id);
  check('an empty seat can be claimed', () => assert.ok(claimed.ok, claimed.message));

  const takerAfterClaim = await pointsOf(taker.id);
  check('the claimer earns the 3x offer', () =>
    assert.equal(takerAfterClaim, takerStart + 3),
  );

  const full = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, slot.id));
  check('the shift is full again', () => assert.equal(full.length, slot.size));

  const raced = await claimOpenSeat(slot.id, second.id);
  check('a second claim on a full shift is refused', () => assert.ok(!raced.ok));
  check('and says why', () => assert.match(raced.message, /full/));

  const dupe = await claimOpenSeat(slot.id, taker.id);
  check('cannot claim a shift you are already on', () => assert.ok(!dupe.ok));

  /* ---------- restore ---------- */
  console.log('\nrestoring');
  const claimedRow = full.find((a) => a.memberId === taker.id)!;
  await unsettleAssignment(claimedRow.id);
  await db.delete(assignmentsTable).where(eq(assignmentsTable.id, claimedRow.id));
  await db.update(slotsTable).set({ coverBounty: 1 }).where(eq(slotsTable.id, slot.id));

  const [restored] = await db
    .insert(assignmentsTable)
    .values({ slotId: slot.id, memberId: owner.id, status: 'assigned', multiplier: 1 })
    .returning({ id: assignmentsTable.id });
  await settleAssignment(restored.id);

  for (const a of [
    'shift.opened_for_cover',
    'slot.bounty_set',
    'shift.seat_claimed',
    'shift.covered',
    'shift.removed',
    'shift.added',
  ]) {
    await db.delete(events).where(eq(events.action, a));
  }

  const finalTotal = (await db.select().from(members)).reduce(
    (n, m) => n + m.points,
    0,
  );
  check('points back to where they started', () =>
    assert.equal(finalTotal, pointsStart),
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
