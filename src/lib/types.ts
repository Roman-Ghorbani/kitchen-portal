/**
 * Core domain types for the ZBT kitchen duty tracker.
 *
 * House rules encoded here (fixed, not per-person configurable):
 *   - Juniors serve lunch. Sophomores serve dinner.
 *   - Nobody serves more than once in a Mon-Sun week, EXCEPT to work off a
 *     make-up shift owed for a prior no-show.
 */

export type Meal = 'lunch' | 'dinner';

/** Only sophomores and juniors are on the duty roster. */
export type ClassYear = 'sophomore' | 'junior';

/** 0 = Monday ... 6 = Sunday. Weeks run Mon-Sun to match the posting cadence. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MEAL_FOR_YEAR: Record<ClassYear, Meal> = {
  junior: 'lunch',
  sophomore: 'dinner',
};

export const YEAR_FOR_MEAL: Record<Meal, ClassYear> = {
  lunch: 'junior',
  dinner: 'sophomore',
};

export type ExemptReason =
  | 'officer'
  | 'medical'
  | 'off-campus'
  | 'other';

export interface Member {
  id: string;
  name: string;
  classYear: ClassYear;
  /**
   * Rotation priority score. Lower is picked first. Increments by 1 for a
   * normally served shift, or by the bounty multiplier (2 or 3) when the
   * kitchen manager awards extra for a last-minute pickup.
   */
  points: number;
  exempt: boolean;
  exemptReason?: ExemptReason;
  exemptNotes?: string;
  /**
   * Day-of-week indices this member can never serve (standing semester
   * conflicts, e.g. a Tuesday lab). Because class year fixes the meal, a
   * single day index is enough - a junior blocking Tuesday is blocking
   * Tuesday lunch.
   */
  standingConflicts: DayIndex[];
  /** ISO date (YYYY-MM-DD) of most recent served shift, for tie-breaking. */
  lastServedDate: string | null;
  /** Unworked make-up shifts owed from no-shows. Forces front-of-queue. */
  makeupDebt: number;
}

/** Which day/meal combinations the house actually serves. Admin-configurable. */
export type MealDayConfig = Record<Meal, boolean[]>;

/**
 * The house serves lunch and dinner six days a week - no meal service on
 * Saturday. Index 0 = Monday, so index 5 (Saturday) is off for both meals.
 * Stored per-semester in the database; this is the seed value.
 */
export const DEFAULT_MEAL_DAYS: MealDayConfig = {
  //          Mon   Tue   Wed   Thu   Fri   Sat   Sun
  lunch: [true, true, true, true, true, false, true],
  dinner: [true, true, true, true, true, true, true],
};

export const DEFAULT_SLOT_SIZES: Record<Meal, number> = {
  lunch: 2,
  dinner: 3,
};

export type AssignmentStatus =
  | 'assigned'
  | 'flagged'      // conflict raised, slot open to volunteers
  | 'covered'      // someone else took it; coverer earns the point
  | 'no-show'      // manager marked absent; generates make-up debt
  | 'excused';     // manager waived it, no debt

export interface Assignment {
  memberId: string;
  status: AssignmentStatus;
  /** Set when status is 'covered' - who actually served. */
  coveredByMemberId?: string;
  /** Point multiplier awarded to whoever served. 1 normally, 2-3 as a bounty. */
  multiplier: number;
  /** True when this assignment exists to work off make-up debt. */
  isMakeup: boolean;
}

export interface Slot {
  date: string; // ISO YYYY-MM-DD
  meal: Meal;
  size: number;
  assignments: Assignment[];
}

export interface WeekSchedule {
  /** ISO date of the Monday this week starts. */
  weekStart: string;
  slots: Slot[];
}

/**
 * What a shift can be worth. Every value is a multiple of 0.5 so the sums stay
 * exact in floating point, and 3 is the ceiling because beyond that a single
 * pickup distorts the rotation for over a month.
 */
export const POINT_MULTIPLIERS = [1, 1.5, 2, 3] as const;

export type PointMultiplier = (typeof POINT_MULTIPLIERS)[number];

export function isValidMultiplier(n: number): boolean {
  return (POINT_MULTIPLIERS as readonly number[]).includes(n);
}

/** Renders a points value without trailing zeros: 0, 1, 1.5, 2, 3. */
export function formatPoints(n: number): string {
  if (n === 0) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
