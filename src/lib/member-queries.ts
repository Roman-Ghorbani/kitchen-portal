/**
 * Member-facing reads: what a given brother personally needs to see.
 */

import { eq, and, inArray, asc } from 'drizzle-orm';

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
  coveredByName: string | null;
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

  const mine = await db
    .select()
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.memberId, memberId),
        inArray(
          assignmentsTable.slotId,
          slotRows.map((s) => s.id),
        ),
      ),
    );

  if (mine.length === 0) return [];

  const mySlotIds = new Set(mine.map((a) => a.slotId));

  // Everyone sharing those slots, so we can list the crew.
  const crewRows = await db
    .select()
    .from(assignmentsTable)
    .where(inArray(assignmentsTable.slotId, [...mySlotIds]));

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
      return {
        assignmentId: a.id,
        date: slot.date,
        meal: slot.meal,
        status: a.status,
        isMakeup: a.isMakeup,
        coveredByName: a.coveredByMemberId
          ? (nameById.get(a.coveredByMemberId) ?? null)
          : null,
        weekStatus: week.status,
        weekLocksAt: week.locksAt,
        crew: crewRows
          .filter((c) => c.slotId === a.slotId && c.memberId !== memberId)
          .map((c) => nameById.get(c.memberId) ?? 'Unknown')
          .sort(),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getMemberById(id: string) {
  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return row ?? null;
}
