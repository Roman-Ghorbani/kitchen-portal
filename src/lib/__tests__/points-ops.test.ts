import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planPoints, checkAmount } from '../points-ops.ts';

const people = [
  { id: 'a', name: 'Adam', points: 4 },
  { id: 'b', name: 'Ben', points: 6.5 },
  { id: 'c', name: 'Cole', points: 0 },
];

describe('bulk points', () => {
  test('add and subtract, never below zero', () => {
    const add = planPoints(people, 'add', 1.5);
    assert.deepEqual(add.changes.map((c) => [c.name, c.after]), [['Adam', 5.5], ['Ben', 8], ['Cole', 1.5]]);

    const sub = planPoints(people, 'subtract', 5);
    assert.deepEqual(sub.changes.map((c) => [c.name, c.after]), [['Adam', 0], ['Ben', 1.5]]);
    assert.equal(sub.unchanged, 1, 'Cole is already at zero');
  });

  test('set gives everyone the same score', () => {
    const plan = planPoints(people, 'set', 4);
    assert.deepEqual(plan.changes.map((c) => c.name), ['Ben', 'Cole']);
    assert.ok(plan.changes.every((c) => c.after === 4));
  });

  test('rebase keeps the order and the gaps', () => {
    const higher = [
      { id: 'a', name: 'Adam', points: 14 },
      { id: 'b', name: 'Ben', points: 16.5 },
      { id: 'c', name: 'Cole', points: 12 },
    ];
    const plan = planPoints(higher, 'rebase', 0);
    assert.equal(plan.rebasedBy, 12);
    const after = Object.fromEntries(plan.changes.map((c) => [c.name, c.after]));
    assert.deepEqual(after, { Adam: 2, Ben: 4.5, Cole: 0 });
    assert.equal(after.Ben - after.Adam, 16.5 - 14);
  });

  test('rebasing a group already at zero changes nothing', () => {
    assert.equal(planPoints(people, 'rebase', 0).changes.length, 0);
  });

  test('amounts are whole or half points within bounds', () => {
    assert.equal(checkAmount('add', 1), null);
    assert.equal(checkAmount('add', 2.5), null);
    assert.equal(checkAmount('set', 0), null);
    assert.match(checkAmount('add', 0)!, /amount/);
    assert.match(checkAmount('add', 1.25)!, /halves/);
    assert.match(checkAmount('add', -1)!, /Subtract/);
    assert.match(checkAmount('add', 101)!, /At most/);
    assert.match(checkAmount('add', Number.NaN)!, /number/);
    assert.equal(checkAmount('rebase', Number.NaN), null);
  });
});
