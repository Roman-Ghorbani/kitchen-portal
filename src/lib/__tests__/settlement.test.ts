import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { desiredOutcome, settleDelta, type SettleInput } from '../settlement.ts';

const ALICE = 'alice';
const BOB = 'bob';

function input(over: Partial<SettleInput> = {}): SettleInput {
  return {
    status: 'assigned',
    memberId: ALICE,
    coveredByMemberId: null,
    multiplier: 1,
    pointsAwarded: 0,
    debtAwarded: 0,
    ...over,
  };
}

describe('what a shift is worth', () => {
  test('serving your own shift earns one point', () => {
    assert.deepEqual(desiredOutcome(input()), {
      recipientId: ALICE,
      points: 1,
      debt: 0,
    });
  });

  test('only the coverer earns the point', () => {
    const o = desiredOutcome(
      input({ status: 'covered', coveredByMemberId: BOB }),
    );
    assert.equal(o.recipientId, BOB);
    assert.equal(o.points, 1);
  });

  test("being covered does not clear the original member's obligation", () => {
    // Nothing is credited to Alice and no debt is charged - she simply stays
    // in the pool at her current total and comes back up in rotation.
    const o = desiredOutcome(
      input({ status: 'covered', coveredByMemberId: BOB }),
    );
    assert.notEqual(o.recipientId, ALICE);
    assert.equal(o.debt, 0);
  });

  test('a no-show earns nothing and owes a make-up', () => {
    assert.deepEqual(desiredOutcome(input({ status: 'no-show' })), {
      recipientId: null,
      points: 0,
      debt: 1,
    });
  });

  test('an excused absence owes nothing', () => {
    assert.deepEqual(desiredOutcome(input({ status: 'excused' })), {
      recipientId: null,
      points: 0,
      debt: 0,
    });
  });

  test('an unresolved flag settles to nothing', () => {
    assert.deepEqual(desiredOutcome(input({ status: 'flagged' })), {
      recipientId: null,
      points: 0,
      debt: 0,
    });
  });

  test('a bounty multiplier is what the coverer earns', () => {
    const o = desiredOutcome(
      input({ status: 'covered', coveredByMemberId: BOB, multiplier: 3 }),
    );
    assert.equal(o.points, 3);
  });
});

describe('first settlement', () => {
  test('credits the assignee', () => {
    const d = settleDelta(input(), null);
    assert.equal(d.points.get(ALICE), 1);
    assert.equal(d.debt.size, 0);
    assert.ok(!d.noop);
  });

  test('a 3x bounty credits three points at once', () => {
    const d = settleDelta(
      input({ status: 'covered', coveredByMemberId: BOB, multiplier: 3 }),
      null,
    );
    assert.equal(d.points.get(BOB), 3);
    assert.equal(d.points.has(ALICE), false);
  });

  test('a no-show charges debt to the assignee, not the coverer', () => {
    const d = settleDelta(input({ status: 'no-show' }), null);
    assert.equal(d.debt.get(ALICE), 1);
    assert.equal(d.points.size, 0);
  });
});

describe('re-settling is idempotent', () => {
  test('settling twice changes nothing the second time', () => {
    const d = settleDelta(input({ pointsAwarded: 1 }), ALICE);
    assert.ok(d.noop, 'a second settlement must be a no-op');
  });

  test('a no-show already charged is not charged again', () => {
    const d = settleDelta(input({ status: 'no-show', debtAwarded: 1 }), null);
    assert.ok(d.noop);
  });
});

describe('corrections after points were already credited', () => {
  // This is the case that matters: Roman credits a shift, then finds out
  // days later the guy never showed.
  test('assigned to no-show takes the point back and charges a make-up', () => {
    const d = settleDelta(
      input({ status: 'no-show', pointsAwarded: 1 }),
      ALICE,
    );
    assert.equal(d.points.get(ALICE), -1, 'the point must be reclaimed');
    assert.equal(d.debt.get(ALICE), 1);
  });

  test('no-show back to assigned restores the point and clears the debt', () => {
    const d = settleDelta(
      input({ status: 'assigned', pointsAwarded: 0, debtAwarded: 1 }),
      null,
    );
    assert.equal(d.points.get(ALICE), 1);
    assert.equal(d.debt.get(ALICE), -1);
  });

  test('no-show to excused clears the debt without granting points', () => {
    const d = settleDelta(
      input({ status: 'excused', debtAwarded: 1 }),
      null,
    );
    assert.equal(d.debt.get(ALICE), -1);
    assert.equal(d.points.size, 0);
  });

  test('credit moving to a coverer takes it from the assignee', () => {
    const d = settleDelta(
      input({ status: 'covered', coveredByMemberId: BOB, pointsAwarded: 1 }),
      ALICE,
    );
    assert.equal(d.points.get(ALICE), -1, 'Alice gives the point back');
    assert.equal(d.points.get(BOB), 1, 'Bob receives it');
  });

  test('raising a coverer bounty credits only the difference', () => {
    // Bob already got 1; Roman bumps it to 3 for stepping up last minute.
    const d = settleDelta(
      input({
        status: 'covered',
        coveredByMemberId: BOB,
        multiplier: 3,
        pointsAwarded: 1,
      }),
      BOB,
    );
    assert.equal(d.points.get(BOB), 2);
    assert.equal(d.points.has(ALICE), false);
  });

  test('lowering a bounty claws the difference back', () => {
    const d = settleDelta(
      input({
        status: 'covered',
        coveredByMemberId: BOB,
        multiplier: 1,
        pointsAwarded: 3,
      }),
      BOB,
    );
    assert.equal(d.points.get(BOB), -2);
  });

  test('a full round trip nets to zero', () => {
    // assigned -> no-show -> assigned should leave points exactly as they were.
    const first = settleDelta(input(), null);
    const toNoShow = settleDelta(
      input({ status: 'no-show', pointsAwarded: 1 }),
      ALICE,
    );
    const back = settleDelta(
      input({ status: 'assigned', pointsAwarded: 0, debtAwarded: 1 }),
      null,
    );

    const netPoints =
      (first.points.get(ALICE) ?? 0) +
      (toNoShow.points.get(ALICE) ?? 0) +
      (back.points.get(ALICE) ?? 0);
    const netDebt =
      (first.debt.get(ALICE) ?? 0) +
      (toNoShow.debt.get(ALICE) ?? 0) +
      (back.debt.get(ALICE) ?? 0);

    assert.equal(netPoints, 1, 'ends up worth exactly one point');
    assert.equal(netDebt, 0, 'ends up owing nothing');
  });
});
