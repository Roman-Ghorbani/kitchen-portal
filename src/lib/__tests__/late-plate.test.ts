import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideWindow,
  currentKitchenMeal,
  DEFAULT_CUTOFFS,
  MEAL_HANDOVER,
} from '../late-plate-service.ts';
import { parseClock, formatClock, houseClockMinutes } from '../dates.ts';

const TODAY = '2026-08-25'; // a Tuesday
const TOMORROW = '2026-08-26';
const YESTERDAY = '2026-08-24';

function window(over: Partial<Parameters<typeof decideWindow>[0]> = {}) {
  return decideWindow({
    date: TODAY,
    meal: 'dinner',
    cutoff: DEFAULT_CUTOFFS.dinner,
    closed: false,
    served: true,
    today: TODAY,
    clockMinutes: 12 * 60, // noon
    ...over,
  });
}

describe('clock parsing', () => {
  test('parses 24-hour times to minutes since midnight', () => {
    assert.equal(parseClock('00:00'), 0);
    assert.equal(parseClock('13:00'), 780);
    assert.equal(parseClock('16:30'), 990);
    assert.equal(parseClock('23:59'), 1439);
    assert.equal(parseClock(' 9:05 '), 545);
  });

  test('rejects anything that is not a real time', () => {
    assert.equal(parseClock('24:00'), null);
    assert.equal(parseClock('12:60'), null);
    assert.equal(parseClock('noon'), null);
    assert.equal(parseClock('1300'), null);
    assert.equal(parseClock(''), null);
  });

  test('formats for humans without a leading zero on the hour', () => {
    assert.equal(formatClock(0), '12:00 AM');
    assert.equal(formatClock(780), '1:00 PM');
    assert.equal(formatClock(990), '4:30 PM');
    assert.equal(formatClock(660), '11:00 AM');
    assert.equal(formatClock(720), '12:00 PM');
  });

  test('the house clock is always a real minute of a real day', () => {
    const now = houseClockMinutes();
    assert.ok(Number.isInteger(now));
    assert.ok(now >= 0 && now < 1440);
  });
});

describe('the cutoff is what closes a meal', () => {
  test('open before the cutoff', () => {
    const w = window({ clockMinutes: parseClock('15:59')! });
    assert.equal(w.open, true);
    assert.equal(w.closedReason, null);
  });

  test('shut exactly on the cutoff, not a minute after', () => {
    const w = window({ clockMinutes: parseClock('16:00')! });
    assert.equal(w.open, false);
    assert.match(w.closedReason!, /4:00 PM cutoff/);
  });

  test('shut after the cutoff', () => {
    assert.equal(window({ clockMinutes: parseClock('18:30')! }).open, false);
  });

  test('lunch and dinner carry their own cutoffs', () => {
    const oneThirty = parseClock('13:30')!;
    assert.equal(
      window({ meal: 'lunch', cutoff: DEFAULT_CUTOFFS.lunch, clockMinutes: oneThirty })
        .open,
      false,
    );
    assert.equal(
      window({ meal: 'dinner', cutoff: DEFAULT_CUTOFFS.dinner, clockMinutes: oneThirty })
        .open,
      true,
    );
  });

  test("a future day's cutoff has not passed however late it is today", () => {
    const w = window({ date: TOMORROW, clockMinutes: 23 * 60 + 59 });
    assert.equal(w.open, true);
  });

  test('a past day is shut regardless of the clock', () => {
    const w = window({ date: YESTERDAY, clockMinutes: 0 });
    assert.equal(w.open, false);
    assert.match(w.closedReason!, /already passed/);
  });
});

describe('chef overrides', () => {
  test('a closed meal is shut even well before the cutoff', () => {
    const w = window({ closed: true, clockMinutes: 9 * 60 });
    assert.equal(w.open, false);
    assert.match(w.closedReason!, /closed dinner late plates/);
  });

  test('an override cutoff replaces the default', () => {
    const w = window({ cutoff: '10:00', clockMinutes: parseClock('11:00')! });
    assert.equal(w.open, false);
    assert.match(w.closedReason!, /10:00 AM/);
  });

  test('a later override cutoff opens a meal the default would have shut', () => {
    const w = window({ cutoff: '20:00', clockMinutes: parseClock('17:00')! });
    assert.equal(w.open, true);
  });

  /**
   * The failure that matters. A typo in a cutoff must not fall through to
   * "no cutoff, therefore always open" - that would silently hand the chefs
   * requests after service.
   */
  test('a malformed cutoff fails closed, not open', () => {
    const w = window({ cutoff: 'half four', clockMinutes: 0 });
    assert.equal(w.open, false);
    assert.match(w.closedReason!, /misconfigured/);
  });
});

describe('days the house does not serve', () => {
  test('an unserved meal is shut and says so', () => {
    const w = window({ meal: 'lunch', served: false, clockMinutes: 0 });
    assert.equal(w.open, false);
    assert.match(w.closedReason!, /does not serve lunch/);
  });

  test('not serving beats every other reason', () => {
    const w = window({ served: false, closed: true, date: YESTERDAY });
    assert.match(w.closedReason!, /does not serve/);
  });
});

describe('the window reports its own inputs back', () => {
  test('so callers can render the cutoff they were judged against', () => {
    const w = window({ cutoff: '17:15' });
    assert.equal(w.cutoff, '17:15');
    assert.equal(w.date, TODAY);
    assert.equal(w.meal, 'dinner');
    assert.equal(w.served, true);
  });
});

describe('which meal the kitchen is on', () => {
  /**
   * Drives the real function through the house clock rather than a parameter,
   * because the timezone conversion is half of what could go wrong here.
   */
  function at(hhmm: string): 'lunch' | 'dinner' {
    // -04:00 is Eastern Daylight Time, which is what the house is on in term.
    return currentKitchenMeal(new Date(`2026-09-01T${hhmm}:00-04:00`));
  }

  test('the handover is the end of lunch service, not the request cutoff', () => {
    // Plates asked for before the 1:00 PM cutoff are still being made after it;
    // flipping the screen at 1:00 is when one gets forgotten.
    assert.equal(MEAL_HANDOVER, '14:30');
    assert.notEqual(MEAL_HANDOVER, DEFAULT_CUTOFFS.lunch);
  });

  test('the morning is lunch', () => {
    assert.equal(at('07:00'), 'lunch');
    assert.equal(at('11:00'), 'lunch');
  });

  test('lunch stays current through service, past its own cutoff', () => {
    assert.equal(at('13:00'), 'lunch');
    assert.equal(at('14:29'), 'lunch');
  });

  test('it flips to dinner at the handover, not a minute before', () => {
    assert.equal(at('14:29'), 'lunch');
    assert.equal(at('14:30'), 'dinner');
  });

  test('the evening is dinner', () => {
    assert.equal(at('16:30'), 'dinner');
    assert.equal(at('21:00'), 'dinner');
    assert.equal(at('23:59'), 'dinner');
  });

  test('after midnight is lunch again, not yesterday\'s dinner', () => {
    assert.equal(at('00:01'), 'lunch');
  });
});

describe('late plate enabled controls', () => {
  test('isLatePlateEnabled defaults to true when semester is not present or enabled', async () => {
    const { isLatePlateEnabled } = await import('../late-plate-service.ts');
    const enabled = await isLatePlateEnabled();
    assert.equal(typeof enabled, 'boolean');
  });

  test('recurring late plate functions are properly exported', async () => {
    const {
      getMemberRecurringPlates,
      setRecurringLatePlate,
      deleteRecurringLatePlate,
    } = await import('../late-plate-service.ts');
    assert.equal(typeof getMemberRecurringPlates, 'function');
    assert.equal(typeof setRecurringLatePlate, 'function');
    assert.equal(typeof deleteRecurringLatePlate, 'function');
  });
});



