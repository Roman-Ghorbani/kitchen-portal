/**
 * Auto-suggest engine.
 *
 * Runs server-side only. Given the roster and the week to fill, it produces a
 * complete assignment set plus a per-pick rationale, so that when somebody
 * argues the schedule is unfair there is a concrete, reproducible answer.
 *
 * Selection order for any open seat:
 *   1. Members owing a make-up shift (forced to the front of the queue)
 *   2. Fewest kitchen points
 *   3. Longest since last served
 *   4. Seeded random - stable for a given week, so re-running the generator
 *      reproduces the identical schedule rather than reshuffling people.
 *
 * Hard constraints, never violated:
 *   - Juniors take lunch, sophomores take dinner
 *   - Exempt members are excluded entirely
 *   - Standing weekly conflicts are excluded
 *   - One shift per person per week, with make-up shifts the sole exception
 *   - Never twice on the same day
 */

import {
  type Meal,
  type Member,
  type MealDayConfig,
  type Slot,
  type WeekSchedule,
  YEAR_FOR_MEAL,
  DEFAULT_MEAL_DAYS,
  DEFAULT_SLOT_SIZES,
} from './types.ts';
import { weekDates, dayIndex, daysBetween } from './dates.ts';

export interface ScheduleInput {
  weekStart: string;
  members: Member[];
  mealDays?: MealDayConfig;
  slotSizes?: Record<Meal, number>;
  /** Defaults to weekStart, which keeps generation reproducible. */
  seed?: string;
}

export interface PickRationale {
  date: string;
  meal: Meal;
  memberId: string;
  memberName: string;
  pointsAtPick: number;
  daysSinceLastServed: number | null;
  viaMakeupDebt: boolean;
  /** How many eligible people were available for this seat. */
  candidatePoolSize: number;
}

export interface UnfilledSlot {
  date: string;
  meal: Meal;
  seatsShort: number;
  reason: string;
}

export interface ScheduleResult {
  week: WeekSchedule;
  rationale: PickRationale[];
  unfilled: UnfilledSlot[];
}

/* ------------------------------------------------------------------ */
/* Deterministic RNG - same seed always yields the same schedule.      */
/* ------------------------------------------------------------------ */

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Working state                                                       */
/* ------------------------------------------------------------------ */

interface WorkingMember {
  member: Member;
  /** Projected points including shifts assigned so far in this run. */
  points: number;
  /** Make-up shifts still owed, decremented as we place them. */
  debt: number;
  /** Dates assigned within this week. */
  assignedDates: string[];
  /** Stable random tiebreak value for this run. */
  jitter: number;
}

function buildSlots(
  weekStart: string,
  mealDays: MealDayConfig,
  slotSizes: Record<Meal, number>,
): Slot[] {
  const dates = weekDates(weekStart);
  const slots: Slot[] = [];
  for (const meal of ['lunch', 'dinner'] as Meal[]) {
    dates.forEach((date, i) => {
      if (!mealDays[meal][i]) return;
      slots.push({ date, meal, size: slotSizes[meal], assignments: [] });
    });
  }
  return slots;
}

/**
 * A member may take a seat if they are the right class year, have no standing
 * conflict that weekday, are not already on that same day, and have not used
 * up their weekly allowance (1, plus 1 per make-up shift owed).
 */
function isEligible(w: WorkingMember, slot: Slot): boolean {
  const m = w.member;
  if (m.exempt) return false;
  if (m.classYear !== YEAR_FOR_MEAL[slot.meal]) return false;
  if (m.standingConflicts.includes(dayIndex(slot.date))) return false;
  if (w.assignedDates.includes(slot.date)) return false;
  const allowance = 1 + w.debt;
  if (w.assignedDates.length >= allowance) return false;
  return true;
}

function comparePriority(a: WorkingMember, b: WorkingMember, openSlots: Slot[]): number {
  // Make-up debt jumps the queue outright.
  if (a.debt !== b.debt) return b.debt - a.debt;
  if (a.points !== b.points) return a.points - b.points;

  // Constraint scoring: members eligible for fewest open slots go first
  const aEligible = openSlots.filter((s) => isEligible(a, s)).length;
  const bEligible = openSlots.filter((s) => isEligible(b, s)).length;
  if (aEligible !== bEligible) return aEligible - bEligible;

  // Longest since last served goes first; never-served sorts to the very front.
  const al = a.member.lastServedDate;
  const bl = b.member.lastServedDate;
  if (al === null && bl !== null) return -1;
  if (bl === null && al !== null) return 1;
  if (al !== null && bl !== null && al !== bl) return al < bl ? -1 : 1;

  return a.jitter - b.jitter;
}

export function generateWeek(input: ScheduleInput): ScheduleResult {
  const {
    weekStart,
    members,
    mealDays = DEFAULT_MEAL_DAYS,
    slotSizes = DEFAULT_SLOT_SIZES,
    seed,
  } = input;

  const rand = mulberry32(hashSeed(seed ?? weekStart));

  const working: WorkingMember[] = members.map((member) => ({
    member,
    points: member.points,
    debt: member.makeupDebt,
    assignedDates: [],
    jitter: rand(),
  }));

  const slots = buildSlots(weekStart, mealDays, slotSizes);
  const rationale: PickRationale[] = [];
  const unfilled: UnfilledSlot[] = [];

  // Most-constrained-seat-first. Filling the scarcest slot before the roomiest
  // stops a scarce day from being starved by people who had other options -
  // e.g. everyone free on Friday getting used up on Monday instead.
  for (;;) {
    const open = slots.filter((s) => s.assignments.length < s.size);
    if (open.length === 0) break;

    let target: Slot | null = null;
    let targetCandidates: WorkingMember[] = [];
    let fewest = Infinity;

    for (const slot of open) {
      const candidates = working.filter((w) => isEligible(w, slot));
      if (candidates.length < fewest) {
        fewest = candidates.length;
        target = slot;
        targetCandidates = candidates;
      }
    }

    if (!target) break;

    if (targetCandidates.length === 0) {
      // Nobody can take this seat. Record why, then shrink the slot so the
      // loop makes progress rather than spinning on an unfillable seat.
      unfilled.push({
        date: target.date,
        meal: target.meal,
        seatsShort: target.size - target.assignments.length,
        reason: describeShortfall(working, target),
      });
      target.size = target.assignments.length;
      continue;
    }

    targetCandidates.sort((a, b) => comparePriority(a, b, open));
    const chosen = targetCandidates[0];
    const viaMakeup = chosen.assignedDates.length >= 1 && chosen.debt > 0;

    target.assignments.push({
      memberId: chosen.member.id,
      status: 'assigned',
      multiplier: 1,
      isMakeup: viaMakeup,
    });

    rationale.push({
      date: target.date,
      meal: target.meal,
      memberId: chosen.member.id,
      memberName: chosen.member.name,
      pointsAtPick: chosen.points,
      daysSinceLastServed: chosen.member.lastServedDate
        ? daysBetween(chosen.member.lastServedDate, target.date)
        : null,
      viaMakeupDebt: viaMakeup,
      candidatePoolSize: targetCandidates.length,
    });

    chosen.assignedDates.push(target.date);
    chosen.points += 1;
    if (viaMakeup) chosen.debt -= 1;
  }

  return { week: { weekStart, slots }, rationale, unfilled };
}

function describeShortfall(working: WorkingMember[], slot: Slot): string {
  const year = YEAR_FOR_MEAL[slot.meal];
  const sameYear = working.filter((w) => w.member.classYear === year);
  const active = sameYear.filter((w) => !w.member.exempt);
  const blocked = active.filter((w) =>
    w.member.standingConflicts.includes(dayIndex(slot.date)),
  );
  const usedUp = active.filter((w) => w.assignedDates.length >= 1 + w.debt);

  return (
    active.length +
    ' active ' +
    year +
    's: ' +
    blocked.length +
    ' blocked by a standing conflict this weekday, ' +
    usedUp.length +
    ' already at their one-shift-per-week limit.'
  );
}
