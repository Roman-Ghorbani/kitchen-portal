/**
 * Deciding what a finished shift is worth.
 *
 * The point is credited the moment somebody is put on the schedule - being
 * scheduled is what earns it, because attendance is assumed. It is taken back
 * only when they actually fail to serve. So this runs at generation, not after
 * the day has passed.
 *
 * Kept pure and separate from the database because this is the arithmetic
 * people argue about, and it has to be re-runnable. Roman corrects attendance
 * whenever he notices - sometimes days later, sometimes after points have
 * already been credited - so settlement is expressed as a *desired end state*
 * rather than an increment. Applying it computes the delta from whatever was
 * credited before, which makes it idempotent and makes every correction
 * reversible without anyone hand-unwinding points.
 */

import type { AssignmentStatus } from './types.ts';

export interface SettleInput {
  status: AssignmentStatus;
  /** Who was originally assigned. */
  memberId: string;
  /** Who actually served, when someone covered. */
  coveredByMemberId: string | null;
  /** 1 normally; 2 or 3 when awarded as a last-minute pickup bounty. */
  multiplier: number;
  /** Points already credited for this assignment by a previous settlement. */
  pointsAwarded: number;
  /** Make-up debt already charged for this assignment. */
  debtAwarded: number;
}

export interface SettleOutcome {
  /** Who should receive the points, or null if nobody earned any. */
  recipientId: string | null;
  /** Points that recipient should hold for this shift in total. */
  points: number;
  /** Make-up shifts the originally assigned member should owe for this shift. */
  debt: number;
}

export interface SettleDelta {
  /** Point changes to apply, keyed by member id. May be negative. */
  points: Map<string, number>;
  /** Make-up debt changes to apply, keyed by member id. May be negative. */
  debt: Map<string, number>;
  /** The end state to record on the assignment. */
  outcome: SettleOutcome;
  /** True when nothing needs writing. */
  noop: boolean;
}

/**
 * What this shift *should* be worth, given its current status.
 *
 * - assigned  the assignee served (attendance is assumed unless corrected)
 * - covered   only the person who actually covered earns the point; the
 *             original assignee's obligation is not cleared, they simply
 *             stay in the pool at their current total
 * - no-show   nobody earns; the assignee owes a make-up shift
 * - excused   nobody earns and nothing is owed
 * - flagged   they handed it back in time, so the point returns with it;
 *             nothing is owed and they rejoin the pool at their old total
 */
export function desiredOutcome(input: SettleInput): SettleOutcome {
  switch (input.status) {
    case 'assigned':
      return { recipientId: input.memberId, points: input.multiplier, debt: 0 };

    case 'covered':
      return {
        recipientId: input.coveredByMemberId,
        points: input.coveredByMemberId ? input.multiplier : 0,
        debt: 0,
      };

    case 'no-show':
      return { recipientId: null, points: 0, debt: 1 };

    case 'excused':
    case 'flagged':
      return { recipientId: null, points: 0, debt: 0 };
  }
}

/**
 * The changes needed to move this assignment from what was previously credited
 * to what it should be worth now.
 *
 * `previousRecipientId` is who last received points for it, which matters when
 * a correction moves the credit from one person to another - the first person
 * has to give it back.
 */
export function settleDelta(
  input: SettleInput,
  previousRecipientId: string | null,
): SettleDelta {
  const outcome = desiredOutcome(input);

  const points = new Map<string, number>();
  const debt = new Map<string, number>();

  const addPoints = (id: string, n: number) => {
    if (n === 0) return;
    points.set(id, (points.get(id) ?? 0) + n);
  };
  const addDebt = (id: string, n: number) => {
    if (n === 0) return;
    debt.set(id, (debt.get(id) ?? 0) + n);
  };

  if (previousRecipientId === outcome.recipientId) {
    // Same person, possibly a different amount.
    if (outcome.recipientId) {
      addPoints(outcome.recipientId, outcome.points - input.pointsAwarded);
    }
  } else {
    // Credit moved: take it back from whoever had it, give it to the new one.
    if (previousRecipientId) addPoints(previousRecipientId, -input.pointsAwarded);
    if (outcome.recipientId) addPoints(outcome.recipientId, outcome.points);
  }

  // Debt always attaches to the originally assigned member, never the coverer.
  addDebt(input.memberId, outcome.debt - input.debtAwarded);

  // Drop any zero entries so a no-change settlement is visibly a no-op.
  for (const [k, v] of [...points]) if (v === 0) points.delete(k);
  for (const [k, v] of [...debt]) if (v === 0) debt.delete(k);

  return {
    points,
    debt,
    outcome,
    noop: points.size === 0 && debt.size === 0,
  };
}
