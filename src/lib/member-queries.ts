/**
 * Member-facing reads: what a given brother personally needs to see.
 */

import { eq, and, or, inArray, asc } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
} from '../db/schema.ts';
import { getActiveSemester } from './week-service.ts';
import type { Meal } from './types.ts';

export interface MyShift {
  assignmentId: string;
  date: string;
  meal: Meal;
  status: string;
  isMakeup: boolean;
  /**
   * How this shift concerns you. 'assigned' is your own turn. 'covering' means
   * you picked it up for somebody else - you are the one who has to show up,
   * and you are the one who earns the point.
   */
  role: 'assigned' | 'covering';
  /** Set when somebody is covering your shift. */
  coveredByName: string | null;
  /** Set when you are covering for somebody - whose shift it originally was. */
  coveringForName: string | null;
  /** Points this shift is worth, including any bounty. */
  multiplier: number;
  /** Points actually credited for it so far. */
  pointsAwarded: number;
  weekStatus: string;
  weekLocksAt: Date | null;
  /** Who else is on that shift, so they know who to coordinate with. */
  crew: string[];
}

export async function getMyShifts(memberId: string): Promise<MyShift[]> {
  const semester = await getActiveSemester();

  const weekRows = await db
    .select()
    .from(weeks)
    .where(eq(weeks.semesterId, semester.id))
    .orderBy(asc(weeks.weekStart));

  if (weekRows.length === 0) return [];

  const slotRows = await db
    .select()
    .from(slotsTable)
    .where(
      inArray(
        slotsTable.weekId,
        weekRows.map((w) => w.id),
      ),
    );

  if (slotRows.length === 0) return [];

  const slotIds = slotRows.map((s) => s.id);

  /**
   * Both the shifts assigned to you AND the ones you picked up for somebody
   * else. Matching only on memberId used to hide covered shifts from the
   * person who actually has to work them, which made volunteering feel like
   * it had done nothing.
   */
  const mine = await db
    .select()
    .from(assignmentsTable)
    .where(
      and(
        or(
          eq(assignmentsTable.memberId, memberId),
          eq(assignmentsTable.coveredByMemberId, memberId),
        ),
        inArray(assignmentsTable.slotId, slotIds),
      ),
    );

  if (mine.length === 0) return [];

  const mySlotIds = [...new Set(mine.map((a) => a.slotId))];

  const crewRows = await db
    .select()
    .from(assignmentsTable)
    .where(inArray(assignmentsTable.slotId, mySlotIds));

  const memberIds = [
    ...new Set(
      crewRows.flatMap((a) =>
        [a.memberId, a.coveredByMemberId].filter((x): x is string => Boolean(x)),
      ),
    ),
  ];

  const nameRows = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(inArray(members.id, memberIds));
  const nameById = new Map(nameRows.map((m) => [m.id, m.name]));

  const slotById = new Map(slotRows.map((s) => [s.id, s]));
  const weekById = new Map(weekRows.map((w) => [w.id, w]));

  return mine
    .map((a) => {
      const slot = slotById.get(a.slotId)!;
      const week = weekById.get(slot.weekId)!;
      const covering = a.coveredByMemberId === memberId;

      return {
        assignmentId: a.id,
        date: slot.date,
        meal: slot.meal,
        status: a.status,
        isMakeup: a.isMakeup,
        role: covering ? ('covering' as const) : ('assigned' as const),
        coveredByName:
          !covering && a.coveredByMemberId
            ? (nameById.get(a.coveredByMemberId) ?? null)
            : null,
        coveringForName: covering ? (nameById.get(a.memberId) ?? null) : null,
        multiplier: a.multiplier,
        pointsAwarded: a.pointsAwarded,
        weekStatus: week.status,
        weekLocksAt: week.locksAt,
        // Whoever is actually turning up, which is the coverer where there is
        // one - the person you need to coordinate with is the one who shows up.
        crew: crewRows
          .filter((c) => c.slotId === a.slotId && c.id !== a.id)
          .map((c) => {
            const who = c.coveredByMemberId ?? c.memberId;
            return nameById.get(who) ?? 'Unknown';
          })
          .sort(),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getMemberById(id: string) {
  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return row ?? null;
}
