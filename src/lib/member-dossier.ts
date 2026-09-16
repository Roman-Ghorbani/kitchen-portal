/**
 * Everything on record about one brother.
 *
 * This is the screen the app exists for. When somebody says at chapter that
 * nobody told him he was on, the answer should take ten seconds to produce and
 * should not require anybody to take the kitchen manager's word for it: the
 * week was posted on this date, the deadline was that date, he opened nothing
 * and flagged nothing, and he was marked absent afterwards.
 */

import { eq, or, and, inArray, desc, asc } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
  standingConflicts,
} from '../db/schema.ts';
import { getActiveSemester } from './week-service.ts';
import type { Meal } from './types.ts';

export interface DossierShift {
  assignmentId: string;
  date: string;
  meal: Meal;
  status: string;
  isMakeup: boolean;
  multiplier: number;
  pointsAwarded: number;
  /** True when this is a shift they picked up for somebody else. */
  covering: boolean;
  coveringForName: string | null;
  coveredByName: string | null;
  /** When the week carrying this shift went on the board. */
  postedAt: Date | null;
  /** When flagging closed for it. */
  weekStatus: string;
  /** How much notice they had, in days, between posting and the shift. */
  noticeDays: number | null;
}

export interface DossierEvent {
  id: string;
  action: string;
  summary: string;
  actorName: string | null;
  createdAt: Date;
}

export interface Dossier {
  member: typeof members.$inferSelect;
  shifts: DossierShift[];
  timeline: DossierEvent[];
  conflicts: { dayIndex: number; note: string | null }[];
  totals: {
    scheduled: number;
    served: number;
    noShows: number;
    covered: number;
    pickedUp: number;
    flagged: number;
    points: number;
  };
}

function daysBetweenDates(a: Date, b: string): number {
  const bd = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((bd - a.getTime()) / 86_400_000);
}

export async function getMemberDossier(memberId: string): Promise<Dossier | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) return null;

  const semester = await getActiveSemester();

  const rows = await db
    .select({ assignment: assignmentsTable, slot: slotsTable, week: weeks })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .innerJoin(weeks, eq(slotsTable.weekId, weeks.id))
    .where(
      or(
        eq(assignmentsTable.memberId, memberId),
        eq(assignmentsTable.coveredByMemberId, memberId),
      ),
    )
    .orderBy(desc(slotsTable.date));

  const otherIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.assignment.memberId, r.assignment.coveredByMemberId])
        .filter((x): x is string => Boolean(x) && x !== memberId),
    ),
  ];

  const names = otherIds.length
    ? await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(inArray(members.id, otherIds))
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  const shifts: DossierShift[] = rows.map((r) => {
    const covering = r.assignment.coveredByMemberId === memberId;
    return {
      assignmentId: r.assignment.id,
      date: r.slot.date,
      meal: r.slot.meal,
      status: r.assignment.status,
      isMakeup: r.assignment.isMakeup,
      multiplier: r.assignment.multiplier,
      pointsAwarded: r.assignment.pointsAwarded,
      covering,
      coveringForName: covering
        ? (nameById.get(r.assignment.memberId) ?? null)
        : null,
      coveredByName:
        !covering && r.assignment.coveredByMemberId
          ? (nameById.get(r.assignment.coveredByMemberId) ?? null)
          : null,
      postedAt: r.week.postedAt,
      weekStatus: r.week.status,
      noticeDays: r.week.postedAt
        ? daysBetweenDates(r.week.postedAt, r.slot.date)
        : null,
    };
  });

  /**
   * Everything the log holds that concerns this person: events about them,
   * events about one of their shifts, and things they did themselves.
   */
  const assignmentIds = rows.map((r) => r.assignment.id);

  const timelineRows = await db
    .select()
    .from(events)
    .where(
      or(
        eq(events.actorMemberId, memberId),
        and(eq(events.entityType, 'member'), eq(events.entityId, memberId)),
        assignmentIds.length > 0
          ? and(
              eq(events.entityType, 'assignment'),
              inArray(events.entityId, assignmentIds),
            )
          : undefined,
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(200);

  const conflictRows = await db
    .select()
    .from(standingConflicts)
    .where(
      and(
        eq(standingConflicts.memberId, memberId),
        eq(standingConflicts.semesterId, semester.id),
      ),
    )
    .orderBy(asc(standingConflicts.dayIndex));

  const own = shifts.filter((s) => !s.covering);

  return {
    member,
    shifts,
    timeline: timelineRows.map((e) => ({
      id: e.id,
      action: e.action,
      summary: e.summary,
      actorName: e.actorName,
      createdAt: e.createdAt,
    })),
    conflicts: conflictRows.map((c) => ({ dayIndex: c.dayIndex, note: c.note })),
    totals: {
      scheduled: own.length,
      served: shifts.filter((s) => s.pointsAwarded > 0).length,
      noShows: own.filter((s) => s.status === 'no-show').length,
      covered: own.filter((s) => s.coveredByName !== null).length,
      pickedUp: shifts.filter((s) => s.covering).length,
      flagged: own.filter((s) => s.status === 'flagged').length,
      points: member.points,
    },
  };
}
