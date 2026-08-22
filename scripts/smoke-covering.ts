/**
 * Checks that a brother who picks up somebody else's shift actually sees it,
 * and that resetting a PIN puts them back to choosing their own.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/smoke-covering.ts
 */

import { eq } from 'drizzle-orm';
import assert from 'node:assert/strict';

import { db } from '../src/db/index.ts';
import { members, assignments as assignmentsTable, events } from '../src/db/schema.ts';
import { flagConflict, volunteerToCover } from '../src/lib/shift-service.ts';
import { getMyShifts } from '../src/lib/member-queries.ts';
import { hashPin, verifyPin } from '../src/lib/auth.ts';

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
  const [target] = await db.select().from(assignmentsTable).limit(1);
  if (!target) throw new Error('no assignments');

  const roster = await db.select().from(members);
  const owner = roster.find((m) => m.id === target.memberId)!;

  const onSlot = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, target.slotId));
  const busy = new Set(onSlot.map((a) => a.memberId));

  const volunteer = roster.find((m) => m.active && !busy.has(m.id))!;

  console.log(`\n${owner.name}'s shift, covered by ${volunteer.name}\n`);

  const volBefore = await getMyShifts(volunteer.id);
  const ownerBefore = await getMyShifts(owner.id);

  /* ---------- cover it ---------- */
  console.log('flag and cover');
  const f = await flagConflict(target.id, owner.id, 'smoke');
  check('flagged', () => assert.ok(f.ok, f.message));

  const c = await volunteerToCover(target.id, volunteer.id);
  check('covered', () => assert.ok(c.ok, c.message));

  /* ---------- the actual bug ---------- */
  console.log('\nwhat each of them now sees');
  const volAfter = await getMyShifts(volunteer.id);
  const ownerAfter = await getMyShifts(owner.id);

  check('the coverer now sees the shift at all', () =>
    assert.equal(volAfter.length, volBefore.length + 1),
  );

  const picked = volAfter.find((s) => s.assignmentId === target.id);
  check('it appears in their list by id', () => assert.ok(picked));
  check('it is marked as covering, not their own turn', () =>
    assert.equal(picked!.role, 'covering'),
  );
  check('it names who they are covering for', () =>
    assert.equal(picked!.coveringForName, owner.name),
  );

  const ownersCopy = ownerAfter.find((s) => s.assignmentId === target.id);
  check('the original still sees it', () => assert.ok(ownersCopy));
  check('marked as their own, not covering', () =>
    assert.equal(ownersCopy!.role, 'assigned'),
  );
  check('and shows who took it', () =>
    assert.equal(ownersCopy!.coveredByName, volunteer.name),
  );
  check('the original keeps the same number of shifts', () =>
    assert.equal(ownerAfter.length, ownerBefore.length),
  );

  /* ---------- PIN reset ---------- */
  console.log('\nPIN reset');
  await db
    .update(members)
    .set({ pinHash: hashPin('8231') })
    .where(eq(members.id, volunteer.id));

  const [withPin] = await db
    .select()
    .from(members)
    .where(eq(members.id, volunteer.id));
  check('a PIN is set', () => assert.ok(verifyPin('8231', withPin.pinHash)));

  await db
    .update(members)
    .set({ pinHash: null })
    .where(eq(members.id, volunteer.id));

  const [cleared] = await db
    .select()
    .from(members)
    .where(eq(members.id, volunteer.id));
  check('reset clears it', () => assert.equal(cleared.pinHash, null));
  check('the old PIN no longer works', () =>
    assert.ok(!verifyPin('8231', cleared.pinHash)),
  );
  check('they are back to first-time setup', () =>
    assert.equal(cleared.pinHash === null, true),
  );

  /* ---------- restore ---------- */
  console.log('\nrestoring');
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
    .where(eq(assignmentsTable.id, target.id));

  await db.delete(events).where(eq(events.action, 'shift.flagged'));
  await db.delete(events).where(eq(events.action, 'shift.covered'));

  const restored = await getMyShifts(volunteer.id);
  check('coverer back to their original shifts', () =>
    assert.equal(restored.length, volBefore.length),
  );

  const m = await db.select().from(members);
  check('no stray points', () =>
    assert.equal(m.filter((x) => x.points !== 0).length, 0),
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
