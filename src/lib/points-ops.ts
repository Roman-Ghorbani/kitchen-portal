/**
 * Changing many people's points at once, computed before anything is written.
 *
 * Pure, so the manager sees exactly what will happen (the preview) and the
 * server re-runs the same function against the live numbers when he confirms.
 *
 * Points are never reset between semesters: they are how the draw stays fair
 * over a brother's whole time in the house. `rebase` is the tool for when the
 * numbers grow large - it subtracts the lowest score from everybody, which
 * shrinks them without changing who is ahead of whom or by how much.
 */

export const POINT_OPS = ['add', 'subtract', 'set', 'rebase'] as const;
export type PointOp = (typeof POINT_OPS)[number];

export const POINT_OP_LABELS: Record<PointOp, string> = {
  add: 'Add',
  subtract: 'Subtract',
  set: 'Set to',
  rebase: 'Rebase (subtract the lowest)',
};

/** Largest single change or target, so a typo cannot wreck the standings. */
export const MAX_POINT_AMOUNT = 100;

export interface PointsHolder {
  id: string;
  name: string;
  points: number;
}

export interface PointsChange {
  id: string;
  name: string;
  before: number;
  after: number;
}

export interface PointsPlan {
  changes: PointsChange[];
  /** People in scope whose points would not move. */
  unchanged: number;
  /** Set only by `rebase`: the amount taken off everybody. */
  rebasedBy?: number;
}

/** Whole or half points, within bounds. Returns an error message or null. */
export function checkAmount(op: PointOp, amount: number): string | null {
  if (op === 'rebase') return null;
  if (!Number.isFinite(amount)) return 'Enter a number.';
  if (amount < 0) return 'Use Subtract rather than a negative number.';
  if (amount > MAX_POINT_AMOUNT) return `At most ${MAX_POINT_AMOUNT} points at a time.`;
  if (Math.round(amount * 2) !== amount * 2) return 'Points go in halves: 1, 1.5, 2 …';
  if (amount === 0 && op !== 'set') return 'Enter an amount.';
  return null;
}

export function planPoints(people: readonly PointsHolder[], op: PointOp, amount: number): PointsPlan {
  const lowest = people.length ? Math.min(...people.map((p) => p.points)) : 0;
  const target = (p: number): number => {
    switch (op) {
      case 'add':
        return p + amount;
      case 'subtract':
        return Math.max(0, p - amount);
      case 'set':
        return amount;
      case 'rebase':
        return p - lowest;
    }
  };

  const changes: PointsChange[] = [];
  let unchanged = 0;
  for (const person of people) {
    const after = target(person.points);
    if (after === person.points) unchanged++;
    else changes.push({ id: person.id, name: person.name, before: person.points, after });
  }
  changes.sort((a, b) => a.name.localeCompare(b.name));

  return { changes, unchanged, ...(op === 'rebase' ? { rebasedBy: lowest } : {}) };
}

/** "Added 2 points" - for messages and the audit log. */
export function describeOp(op: PointOp, amount: number, rebasedBy?: number): string {
  const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`;
  switch (op) {
    case 'add':
      return `added ${pts(amount)}`;
    case 'subtract':
      return `subtracted ${pts(amount)}`;
    case 'set':
      return `set points to ${amount}`;
    case 'rebase':
      return `rebased points (subtracted the lowest, ${rebasedBy ?? 0})`;
  }
}
