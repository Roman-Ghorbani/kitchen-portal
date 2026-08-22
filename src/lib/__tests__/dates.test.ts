import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  dayIndex,
  mondayOf,
  weekDates,
  daysBetween,
  nextSunday,
  chapterLockFor,
  weekPostedAtChapter,
  lastChapterOnOrBefore,
  weekDueForPosting,
} from '../dates.ts';

describe('day indexing', () => {
  test('Monday is 0 and Sunday is 6', () => {
    assert.equal(dayIndex('2026-08-24'), 0); // Monday
    assert.equal(dayIndex('2026-08-25'), 1);
    assert.equal(dayIndex('2026-08-29'), 5); // Saturday
    assert.equal(dayIndex('2026-08-30'), 6); // Sunday
  });

  test('mondayOf snaps back to the start of the week', () => {
    assert.equal(mondayOf('2026-08-24'), '2026-08-24');
    assert.equal(mondayOf('2026-08-27'), '2026-08-24');
    assert.equal(mondayOf('2026-08-30'), '2026-08-24'); // Sunday belongs to it
    assert.equal(mondayOf('2026-08-31'), '2026-08-31');
  });

  test('weekDates yields seven consecutive days from Monday', () => {
    const d = weekDates('2026-08-24');
    assert.equal(d.length, 7);
    assert.equal(d[0], '2026-08-24');
    assert.equal(d[6], '2026-08-30');
  });
});

describe('date arithmetic crosses boundaries correctly', () => {
  test('spans a month end', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(daysBetween('2026-08-24', '2026-09-01'), 8);
  });

  test('spans a year end', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  test('is unaffected by daylight saving', () => {
    // US DST ends Nov 1 2026. A naive local-time implementation drifts here.
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', 1), '2026-11-02');
    assert.equal(daysBetween('2026-10-25', '2026-11-08'), 14);
    assert.equal(mondayOf('2026-11-01'), '2026-10-26');
  });
});

describe('nextSunday', () => {
  test('from a Monday, reaches the Sunday six days later', () => {
    assert.equal(nextSunday('2026-08-24'), '2026-08-30');
    assert.equal(dayIndex(nextSunday('2026-08-24')), 6);
  });

  test('from every weekday, lands on a Sunday', () => {
    for (const d of [
      '2026-08-24', '2026-08-25', '2026-08-26',
      '2026-08-27', '2026-08-28', '2026-08-29',
    ]) {
      const s = nextSunday(d);
      assert.equal(dayIndex(s), 6, `${d} -> ${s} should be a Sunday`);
      assert.ok(s > d, `${s} should be after ${d}`);
      assert.ok(daysBetween(d, s) <= 6);
    }
  });

  test('from a Sunday, moves to the following Sunday', () => {
    assert.equal(nextSunday('2026-08-30'), '2026-09-06');
    assert.equal(dayIndex(nextSunday('2026-08-30')), 6);
  });
});

describe('which week the cadence is due to post', () => {
  test('finds the most recent chapter', () => {
    assert.equal(lastChapterOnOrBefore('2026-08-23'), '2026-08-23'); // a Sunday
    assert.equal(lastChapterOnOrBefore('2026-08-24'), '2026-08-23'); // Monday
    assert.equal(lastChapterOnOrBefore('2026-08-21'), '2026-08-16'); // Friday
  });

  test('is driven by the calendar, not by what already exists', () => {
    // Running the transition repeatedly on the same day must keep naming the
    // same week, or the button would post weeks arbitrarily far ahead.
    assert.equal(weekDueForPosting('2026-08-21'), '2026-08-24');
    assert.equal(weekDueForPosting('2026-08-22'), '2026-08-24');
    assert.equal(weekDueForPosting('2026-08-23'), '2026-08-31');
    assert.equal(weekDueForPosting('2026-08-24'), '2026-08-31');
    assert.equal(weekDueForPosting('2026-08-29'), '2026-08-31');
    assert.equal(weekDueForPosting('2026-08-30'), '2026-09-07');
  });

  test('the due week is always a Monday', () => {
    let d = '2026-08-17';
    for (let i = 0; i < 40; i++) {
      assert.equal(dayIndex(weekDueForPosting(d)), 0, `${d}`);
      d = addDays(d, 1);
    }
  });

  test('the due week always starts at least 8 days after its chapter', () => {
    let d = '2026-08-17';
    for (let i = 0; i < 40; i++) {
      const chapter = lastChapterOnOrBefore(d);
      const week = weekDueForPosting(d);
      assert.equal(daysBetween(chapter, week), 8, `from ${d}`);
      d = addDays(d, 1);
    }
  });
});

describe('the lock deadline', () => {
  // This is the backbone of the accountability claim: a week must stop
  // accepting conflict flags BEFORE it runs, never after.
  test('a week locks the Sunday immediately before it starts', () => {
    assert.equal(chapterLockFor('2026-08-24'), '2026-08-23');
    assert.equal(dayIndex(chapterLockFor('2026-08-24')), 6);
  });

  test('the lock is always before the week begins', () => {
    let week = '2026-08-24';
    for (let i = 0; i < 16; i++) {
      const lock = chapterLockFor(week);
      assert.ok(lock < week, `lock ${lock} must precede week start ${week}`);
      assert.equal(dayIndex(lock), 6, `lock ${lock} must be a Sunday`);
      week = addDays(week, 7);
    }
  });

  test('the normal cadence gives exactly a 7-day flag window', () => {
    // Posted at chapter, the week starts 8 days later and locks at the next
    // chapter - so it is open for flags for exactly one week.
    const chapter = '2026-08-30';
    const week = weekPostedAtChapter(chapter);
    assert.equal(week, '2026-09-07');
    assert.equal(dayIndex(week), 0, 'a posted week must start on a Monday');

    const lock = chapterLockFor(week);
    assert.equal(daysBetween(chapter, lock), 7);
  });
});
