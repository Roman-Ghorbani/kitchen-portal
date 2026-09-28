/**
 * Standings: where everybody sits on points.
 *
 * Deliberately NOT a prediction. The draw weighs make-up debt first, then
 * points, then how long since you last served, then a seeded tie-break, and
 * standing conflicts remove people from a given day entirely. A list sorted on
 * points alone therefore cannot tell anyone which week he is on, and the page
 * says so rather than implying a countdown - a brother who concludes he is
 * safe this week and skips is exactly the failure this must not cause.
 *
 * Sorted most points to fewest, so rank 1 is whoever has served most. That is
 * the inverse of the draw order and is the right way round for the question
 * brothers actually asked, which was "where do I sit relative to everyone".
 */

import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { members } from '../db/schema.ts';
import type { Meal } from './types.ts';

export interface StandingRow {
  id: string;
  name: string;
  rotation: Meal;
  points: number;
  /** 1-based, most points first. Ties share the order the query returns. */
  rank: number;
}

export interface Standings {
  rows: StandingRow[];
  /** Where the viewer sits, when the viewer is on the rotation at all. */
  me: { rank: number; points: number; total: number } | null;
}

/**
 * Everyone on the rotation. Exempt brothers are left out entirely rather than
 * shown greyed: they are not in the draw, so listing them would only invite
 * "why is he on zero".
 */
export async function getStandings(viewerId: string | null): Promise<Standings> {
  const roster = await db
    .select({
      id: members.id,
      name: members.name,
      rotation: members.rotation,
      points: members.points,
    })
    .from(members)
    .where(and(eq(members.active, true), eq(members.exempt, false)))
    .orderBy(desc(members.points), asc(members.name));

  const rows: StandingRow[] = roster.map((r, i) => ({ ...r, rank: i + 1 }));

  const mine = viewerId ? rows.find((r) => r.id === viewerId) : undefined;

  return {
    rows,
    me: mine
      ? { rank: mine.rank, points: mine.points, total: rows.length }
      : null,
  };
}
