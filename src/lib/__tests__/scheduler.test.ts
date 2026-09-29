import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateWeek } from '../scheduler.ts';
import { dayIndex, addDays } from '../dates.ts';
import type { Member, DayIndex, MealDayConfig } from '../types.ts';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeMember(
  id: number,
  classYear: 'junior' | 'sophomore',
  overrides: Partial<Member> = {},
): Member {
  return {
    id: String(id),
    name: `${classYear === 'junior' ? 'Jr' : 'So'} ${id}`,
    classYear,
    // The house's usual default; crew and year are independent (see below).
    rotation: classYear === 'junior' ? 'lunch' : 'dinner',
    points: 0,
    exempt: false,
    standingConflicts: [],
    lastServedDate: null,
    makeupDebt: 0,
    ...overrides,
  };
}

/** A roster sized like the real house: ~96 live-ins, sophomores + juniors on duty. */
function makeRoster(juniors = 28, sophomores = 30): Member[] {
  const members: Member[] = [];
  for (let i = 0; i < juniors; i++) members.push(makeMember(i, 'junior'));
  for (let i = 0; i < sophomores; i++)
    members.push(makeMember(1000 + i, 'sophomore'));
  return members;
}

const WEEK = '2026-08-24'; // Monday

function countAssignmentsPerMember(
  result: ReturnType<typeof generateWeek>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of result.week.slots) {
    for (const a of slot.assignments) {
      counts.set(a.memberId, (counts.get(a.memberId) ?? 0) + 1);
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */

describe('hard constraints', () => {
  test('fills every seat with a full-size roster', () => {
    const result = generateWeek({ weekStart: WEEK, members: makeRoster() });

    assert.equal(result.unfilled.length, 0, 'expected no unfilled slots');
    for (const slot of result.week.slots) {
      assert.equal(
        slot.assignments.length,
        slot.size,
        `${slot.date} ${slot.meal} was short`,
      );
    }
    // House default is 6 lunch days + 7 dinner days (Saturday dinner for cleanings).
    const total = result.week.slots.reduce((n, s) => n + s.assignments.length, 0);
    assert.equal(total, 33);
  });

  test('only Saturday dinner is generated on Saturday (no Saturday lunch)', () => {
    const result = generateWeek({ weekStart: WEEK, members: makeRoster() });
    const saturdays = result.week.slots.filter((s) => dayIndex(s.date) === 5);
    assert.equal(saturdays.length, 1, 'Saturday has dinner service for supplemental cleanings');
    assert.equal(saturdays[0].meal, 'dinner');
  });

  test('nobody is scheduled more than once in a week', () => {
    const counts = countAssignmentsPerMember(
      generateWeek({ weekStart: WEEK, members: makeRoster() }),
    );
    for (const [id, n] of counts) {
      assert.ok(n <= 1, `member ${id} got ${n} shifts in one week`);
    }
  });

  test('each crew only ever takes its own meal', () => {
    const members = makeRoster();
    const byId = new Map(members.map((m) => [m.id, m]));
    const result = generateWeek({ weekStart: WEEK, members });

    for (const slot of result.week.slots) {
      for (const a of slot.assignments) {
        const m = byId.get(a.memberId)!;
        assert.equal(m.rotation, slot.meal, `${m.name} on ${slot.meal}`);
      }
    }
  });

  test('the crew decides the meal, not the class year', () => {
    // A sophomore by class who serves with the juniors, and a live-in senior
    // who is on the dinner crew rather than exempt.
    const lateRusher = makeMember(1, 'sophomore', { rotation: 'lunch' });
    const senior = makeMember(2, 'junior', { classYear: 'senior', rotation: 'dinner' });
    const result = generateWeek({
      weekStart: WEEK,
      members: [lateRusher, senior],
      slotSizes: { lunch: 1, dinner: 1 },
    });
    const meals = (id: string) =>
      result.week.slots.filter((s) => s.assignments.some((a) => a.memberId === id)).map((s) => s.meal);
    assert.deepEqual(meals('1'), ['lunch']);
    assert.deepEqual(meals('2'), ['dinner']);
  });

  test('exempt members are never assigned', () => {
    const members = makeRoster();
    members[0].exempt = true;
    members[1].exempt = true;
    members[30].exempt = true;

    const result = generateWeek({ weekStart: WEEK, members });
    const assigned = new Set(countAssignmentsPerMember(result).keys());

    assert.ok(!assigned.has(members[0].id));
    assert.ok(!assigned.has(members[1].id));
    assert.ok(!assigned.has(members[30].id));
  });

  test('standing weekly conflicts are respected', () => {
    const members = makeRoster();
    // Every junior blocks Tuesday (index 1) except a handful.
    const blocked: DayIndex = 1;
    for (const m of members) {
      if (m.classYear === 'junior') m.standingConflicts = [blocked];
    }
    members[0].standingConflicts = [];
    members[1].standingConflicts = [];

    const result = generateWeek({ weekStart: WEEK, members });
    const tuesdayLunch = result.week.slots.find(
      (s) => s.meal === 'lunch' && dayIndex(s.date) === blocked,
    )!;

    const ids = tuesdayLunch.assignments.map((a) => a.memberId).sort();
    assert.deepEqual(ids, [members[0].id, members[1].id].sort());
  });

  test('a member is never placed twice on the same day', () => {
    // Give one junior heavy debt so the allowance would otherwise permit it.
    const members = makeRoster(3, 30);
    members[0].makeupDebt = 5;

    const result = generateWeek({ weekStart: WEEK, members });
    for (const slot of result.week.slots) {
      const ids = slot.assignments.map((a) => a.memberId);
      assert.equal(new Set(ids).size, ids.length, `dup on ${slot.date}`);
    }
  });
});

describe('priority ordering', () => {
  test('lowest points are picked before higher points', () => {
    const members = makeRoster();
    for (const m of members) m.points = 5;
    // Two juniors and three sophomores are behind on points.
    const behind = [members[10], members[11], members[40], members[41], members[42]];
    for (const m of behind) m.points = 0;

    const result = generateWeek({ weekStart: WEEK, members });
    const counts = countAssignmentsPerMember(result);

    for (const m of behind) {
      assert.equal(counts.get(m.id), 1, `${m.name} was behind but not picked`);
    }
  });

  test('make-up debt jumps the queue ahead of low points', () => {
    const members = makeRoster();
    for (const m of members) m.points = 0;

    const debtor = members.find((m) => m.classYear === 'junior')!;
    debtor.points = 99; // would normally sort dead last
    debtor.makeupDebt = 1;

    const result = generateWeek({ weekStart: WEEK, members });
    const counts = countAssignmentsPerMember(result);

    assert.ok(
      (counts.get(debtor.id) ?? 0) >= 1,
      'debtor should be force-scheduled despite high points',
    );
  });

  test('the make-up is the pick he got for owing it, and a second pick is ordinary', () => {
    // Small junior pool so the debtor has to be reused.
    const members = makeRoster(2, 30);
    members[0].makeupDebt = 1;

    const result = generateWeek({ weekStart: WEEK, members });
    const counts = countAssignmentsPerMember(result);
    assert.equal(counts.get(members[0].id), 2, 'a short pool can draw him twice');

    const mine = result.week.slots
      .flatMap((s) => s.assignments)
      .filter((a) => a.memberId === members[0].id);
    assert.equal(mine.filter((a) => a.isMakeup).length, 1, 'exactly one of them is the make-up');
    assert.equal(result.debtResolved?.[members[0].id], 1);
  });

  test('owing a make-up does not force a second shift', () => {
    const members = makeRoster();
    for (const m of members) m.points = 0;
    const debtor = members.find((m) => m.classYear === 'junior')!;
    debtor.points = 99;
    debtor.makeupDebt = 1;

    const result = generateWeek({ weekStart: WEEK, members });
    assert.equal(countAssignmentsPerMember(result).get(debtor.id), 1, 'picked first, once');
    const pick = result.rationale.find((r) => r.memberId === debtor.id)!;
    assert.equal(pick.viaMakeupDebt, true);
  });

  test('after his make-up he can still be drawn again if he is low on points', () => {
    const members = makeRoster(4, 30);
    for (const m of members) m.points = 10;
    const debtor = members.find((m) => m.classYear === 'junior')!;
    debtor.points = 0;
    debtor.makeupDebt = 1;

    const result = generateWeek({ weekStart: WEEK, members });
    const mine = result.week.slots
      .flatMap((s) => s.assignments)
      .filter((a) => a.memberId === debtor.id);
    assert.equal(mine.length, 2, 'lowest points, so the draw picks him again');
    assert.equal(mine.filter((a) => a.isMakeup).length, 1);
  });

  test('longer since last served breaks a points tie', () => {
    const members = makeRoster(2, 30);
    members[0].points = 1;
    members[1].points = 1;
    members[0].lastServedDate = '2026-08-01'; // longer ago
    members[1].lastServedDate = '2026-08-18';

    const result = generateWeek({ weekStart: WEEK, members });
    const mondayLunch = result.week.slots.find(
      (s) => s.meal === 'lunch' && s.date === WEEK,
    )!;
    // Pool is exactly 2 so both serve, but the staler one is recorded first.
    assert.equal(mondayLunch.assignments[0].memberId, members[0].id);
  });

  test('constrained members win tie-breakers over flexible members', () => {
    // Create 3 juniors (need 5 seats filled across Mon-Fri lunch).
    // All have 0 points.
    // Junior 0 has NO conflicts (flexible, can work Mon-Fri).
    // Junior 1 has conflicts Mon, Tue, Wed, Thu (can ONLY work Friday).
    // Junior 2 has conflicts Mon, Tue, Wed, Fri (can ONLY work Thursday).
    const members = makeRoster(3, 30);
    members[0].standingConflicts = [];
    members[1].standingConflicts = [0, 1, 2, 3]; // Only free Friday (index 4)
    members[2].standingConflicts = [0, 1, 2, 4]; // Only free Thursday (index 3)

    const result = generateWeek({ weekStart: WEEK, members });
    
    // We expect Junior 1 to get Friday, and Junior 2 to get Thursday.
    // Junior 0 should pick up Monday, Tuesday, or Wednesday.
    const thursdayLunch = result.week.slots.find(
      (s) => s.meal === 'lunch' && dayIndex(s.date) === 3,
    )!;
    const fridayLunch = result.week.slots.find(
      (s) => s.meal === 'lunch' && dayIndex(s.date) === 4,
    )!;

    // Both highly constrained members must be successfully assigned to their only available days
    assert.equal(thursdayLunch.assignments[0].memberId, members[2].id);
    assert.equal(fridayLunch.assignments[0].memberId, members[1].id);
  });
});

describe('determinism and rotation', () => {
  test('the same input reproduces the identical schedule', () => {
    const a = generateWeek({ weekStart: WEEK, members: makeRoster() });
    const b = generateWeek({ weekStart: WEEK, members: makeRoster() });
    assert.deepEqual(a.week, b.week);
  });

  test('a different week produces a different draw', () => {
    const a = generateWeek({ weekStart: WEEK, members: makeRoster() });
    const b = generateWeek({
      weekStart: addDays(WEEK, 7),
      members: makeRoster(),
    });
    const aIds = a.week.slots.flatMap((s) => s.assignments.map((x) => x.memberId));
    const bIds = b.week.slots.flatMap((s) => s.assignments.map((x) => x.memberId));
    assert.notDeepEqual(aIds, bIds, 'identical rosters should not draw identically');
  });

  test('picks are not alphabetical when everyone is tied', () => {
    const members = makeRoster();
    const result = generateWeek({ weekStart: WEEK, members });
    const lunchIds = result.week.slots
      .filter((s) => s.meal === 'lunch')
      .flatMap((s) => s.assignments.map((a) => Number(a.memberId)));

    // A purely alphabetical/id-ordered tiebreak would yield 0,1,2,3...
    const sequential = lunchIds.every((id, i) => id === i);
    assert.ok(!sequential, 'tiebreak collapsed to roster order');
  });
});

describe('fairness across a semester', () => {
  test('point spread stays tight over 15 weeks', () => {
    const members = makeRoster();
    let week = WEEK;

    for (let w = 0; w < 15; w++) {
      const result = generateWeek({ weekStart: week, members });
      for (const slot of result.week.slots) {
        for (const a of slot.assignments) {
          const m = members.find((x) => x.id === a.memberId)!;
          m.points += a.multiplier;
          m.lastServedDate = slot.date;
        }
      }
      week = addDays(week, 7);
    }

    for (const year of ['junior', 'sophomore'] as const) {
      const pts = members.filter((m) => m.classYear === year).map((m) => m.points);
      const spread = Math.max(...pts) - Math.min(...pts);
      assert.ok(
        spread <= 1,
        `${year} point spread was ${spread} (min ${Math.min(...pts)}, max ${Math.max(...pts)})`,
      );
    }
  });
});

describe('configurable meal days', () => {
  test('turning off weekend meals removes those slots', () => {
    const weekdaysOnly: MealDayConfig = {
      lunch: [true, true, true, true, true, false, false],
      dinner: [true, true, true, true, true, false, false],
    };
    const result = generateWeek({
      weekStart: WEEK,
      members: makeRoster(),
      mealDays: weekdaysOnly,
    });

    assert.equal(result.week.slots.length, 10); // 5 lunch + 5 dinner
    const total = result.week.slots.reduce((n, s) => n + s.assignments.length, 0);
    assert.equal(total, 25);
  });
});

describe('shortfall reporting', () => {
  test('an under-staffed pool reports why it could not fill', () => {
    // Only 1 junior for 14 lunch seats.
    const result = generateWeek({ weekStart: WEEK, members: makeRoster(1, 30) });

    assert.ok(result.unfilled.length > 0);
    const lunchGaps = result.unfilled.filter((u) => u.meal === 'lunch');
    assert.ok(lunchGaps.length > 0);
    assert.match(lunchGaps[0].reason, /limit for the week/);
  });
});

describe('make-up debt', () => {
  test('a brother who owes a make-up is picked ahead of lower points', () => {
    const debtor: Member = {
      id: 'junior-debtor',
      name: 'Owes One',
      classYear: 'junior',
      rotation: 'lunch',
      points: 10,
      exempt: false,
      standingConflicts: [],
      lastServedDate: '2026-09-01',
      makeupDebt: 1,
    };
    const fresh: Member = { ...debtor, id: 'junior-fresh', name: 'Fresh', points: 0, makeupDebt: 0 };

    const result = generateWeek({
      weekStart: '2026-09-28',
      members: [debtor, fresh],
      slotSizes: { lunch: 1, dinner: 1 },
    });

    const pick = result.rationale.find((r) => r.memberId === debtor.id);
    assert.ok(pick, 'the debtor was scheduled');
    assert.equal(pick.viaMakeupDebt, true, 'and picked because of the debt');
  });
});
