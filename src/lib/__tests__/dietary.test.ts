/**
 * The flag catalogue and how it is summarised for the kitchen.
 *
 * The failures worth catching here are quiet ones: a flag silently dropped, an
 * allergen sorted in with the religious restrictions, or "Other" reaching a
 * chef as the literal word "Other", which tells them nothing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIETARY_FLAGS,
  ALLERGENS,
  DIETARY,
  OTHER_FLAG_ID,
  isDietaryFlag,
  normaliseFlags,
  labelFor,
  kindOf,
  summariseFlags,
} from '../dietary.ts';

describe('the catalogue', () => {
  test('ids are unique', () => {
    const ids = DIETARY_FLAGS.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every flag is exactly one kind, and both groups are non-empty', () => {
    assert.equal(ALLERGENS.length + DIETARY.length, DIETARY_FLAGS.length);
    assert.ok(ALLERGENS.length > 0);
    assert.ok(DIETARY.length > 0);
  });

  test('covers the nine major US allergens plus gluten', () => {
    const ids = new Set(ALLERGENS.map((f) => f.id));
    for (const required of [
      'milk',
      'egg',
      'fish',
      'shellfish',
      'tree-nuts',
      'peanuts',
      'wheat',
      'soy',
      'sesame',
      'gluten-free',
    ]) {
      assert.ok(ids.has(required), `missing allergen: ${required}`);
    }
  });

  test('the religious and dietary flags Roman asked for are present', () => {
    const ids = new Set(DIETARY.map((f) => f.id));
    for (const required of [
      'kosher',
      'kosher-passover',
      'lent',
      'ramadan',
      'no-beef',
      OTHER_FLAG_ID,
    ]) {
      assert.ok(ids.has(required), `missing dietary flag: ${required}`);
    }
  });

  test('an allergen is never classed as merely dietary', () => {
    assert.equal(kindOf('peanuts'), 'allergen');
    assert.equal(kindOf('kosher'), 'dietary');
    assert.equal(kindOf('nonsense'), null);
  });
});

describe('normalising what arrives from a browser', () => {
  test('keeps known flags and drops unknown ones', () => {
    assert.deepEqual(normaliseFlags(['peanuts', 'unicorns', 'kosher']), [
      'peanuts',
      'kosher',
    ]);
  });

  test('de-duplicates', () => {
    assert.deepEqual(normaliseFlags(['peanuts', 'peanuts']), ['peanuts']);
  });

  test('always returns catalogue order, whatever order it was given', () => {
    const a = normaliseFlags(['kosher', 'peanuts', 'sesame']);
    const b = normaliseFlags(['sesame', 'kosher', 'peanuts']);
    assert.deepEqual(a, b);
  });

  test('survives junk instead of an array', () => {
    assert.deepEqual(normaliseFlags(null), []);
    assert.deepEqual(normaliseFlags('peanuts'), []);
    assert.deepEqual(normaliseFlags([1, {}, null, 'peanuts']), ['peanuts']);
  });

  test('isDietaryFlag agrees with the catalogue', () => {
    assert.equal(isDietaryFlag('sesame'), true);
    assert.equal(isDietaryFlag('sesame-seed'), false);
  });
});

describe('what the kitchen is shown', () => {
  test('allergens come first, because they are the ones that hurt', () => {
    const s = summariseFlags(['kosher', 'peanuts'], null);
    assert.deepEqual(s.lines, ['Peanuts', 'Kosher']);
    assert.deepEqual(s.allergens, ['Peanuts']);
    assert.deepEqual(s.dietary, ['Kosher']);
    assert.equal(s.hasAllergen, true);
  });

  test('a dietary-only request is flagged but not an allergen', () => {
    const s = summariseFlags(['lent'], null);
    assert.equal(s.hasAny, true);
    assert.equal(s.hasAllergen, false);
  });

  test('nothing ticked is nothing to show', () => {
    const s = summariseFlags([], null);
    assert.equal(s.hasAny, false);
    assert.equal(s.hasAllergen, false);
    assert.deepEqual(s.lines, []);
  });

  test('"Other" is replaced by his actual words', () => {
    const s = summariseFlags([OTHER_FLAG_ID], 'no raw onion, it makes me ill');
    assert.deepEqual(s.lines, ['Other: no raw onion, it makes me ill']);
  });

  /**
   * The one that would otherwise slip through: he typed a restriction but did
   * not tick the box. The text still has to reach the kitchen.
   */
  test('free text without the box ticked still reaches the kitchen', () => {
    const s = summariseFlags(['peanuts'], 'also no cilantro');
    assert.equal(s.hasAny, true);
    assert.deepEqual(s.lines, ['Peanuts', 'Other: also no cilantro']);
  });

  test('a ticked Other with nothing written says so rather than vanishing', () => {
    const s = summariseFlags([OTHER_FLAG_ID], '   ');
    assert.deepEqual(s.lines, ['Other (unspecified)']);
  });

  test('unknown stored ids do not reach a chef as raw ids', () => {
    const s = summariseFlags(['peanuts', 'retired-flag'], null);
    assert.deepEqual(s.lines, ['Peanuts']);
  });

  test('null flags are treated as none, not as a crash', () => {
    const s = summariseFlags(null, null);
    assert.equal(s.hasAny, false);
  });

  test('labels are rendered, ids are stored', () => {
    assert.equal(labelFor('tree-nuts'), 'Tree nuts');
    assert.equal(labelFor('no-beef'), 'No beef');
    // An id with no catalogue entry falls back to itself rather than throwing.
    assert.equal(labelFor('mystery'), 'mystery');
  });
});
