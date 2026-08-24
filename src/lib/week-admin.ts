/**
 * Manual overrides for the kitchen manager.
 *
 * The rest of the app treats a posted week as fixed, because the record of
 * what the house was told is the whole point. Reality still needs an escape
 * hatch: a week generated against a stale roster, two brothers who swapped
 * between themselves, somebody who should never have been on that day.
 *
 * So overrides are allowed, but never quietly. Every one writes an events row
 * naming who changed what and what it was before, and unpublishing is refused
 * for a week that has already begun - rewriting a week people already worked
 * would destroy exactly the evidence this app exists to keep.
 */

import { eq, and, inArray, asc } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../db/schema.ts';
import { unsettleAssignment, settleAssignment } from './shift-service.ts';
import { YEAR_FOR_MEAL } from './types.ts';
import { dayIndex, todayInEastern } from './dates.ts';

export interface AdminResult {
  ok: boolean;
  message: string;
}

async function loadWeek(weekId: string) {
  const [w] = await db.select().from(weeks).where(eq(weeks.id, weekId)).limit(1);
  return w ?? null;
}

async function nameOf(id: string): Promise<string> {
  const [m] = await db
    .select({ name: members.name })
    .from(members)
    .where(eq(members.id, id))
    .limit(1);
  return m?.name ?? 'Unknown';
}

function today(): string {
  return todayInEastern();
}

/* ------------------------------------------------------------------ */
/* Week-level                                                          */
/* ------------------------------------------------------------------ */

/**
 * Locks a week: no more conflict flags, no more picking shifts up.
 *
 * Deliberately a manual switch rather than something that happens on a
 * schedule. The lock is what makes "you had a week to say something" true, so
 * the kitchen manager should be the one who decides the moment it falls, and
 * should be able to see plainly whether it has.
 */
export async function lockWeek(
  weekId: string,
  actorName: string,
): Promise<AdminResult> {
  const w = await loadWeek(weekId);
  if (!w) return { ok: false, message: 'No such week.' };
  if (w.status === 'locked' || w.status === 'complete') {
    return { ok: true, message: 'That week is already locked.' };
  }

  await db
    .update(weeks)
    .set({ status: 'locked', lockedAt: new Date() })
    .where(eq(weeks.id, weekId));

  const stillOpen = await db
    .select({ id: assignmentsTable.id })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .where(
      and(eq(slotsTable.weekId, weekId), eq(assignmentsTable.status, 'flagged')),
    );

  await db.insert(events).values({
    action: 'week.locked',
    entityType: 'week',
    entityId: weekId,
    actorName,
    summary:
      `${actorName} locked the week of ${w.weekStart}` +
      (stillOpen.length > 0
        ? ` with ${stillOpen.length} shift(s) still needing cover`
        : ''),
    payload: { weekStart: w.weekStart, unresolved: stillOpen.length },
  });

  return {
    ok: true,
    message:
      `Week of ${w.weekStart} is locked — no more flagging or pickups.` +
      (stillOpen.length > 0
        ? ` ${stillOpen.length} shift(s) still need cover; put somebody on them yourself.`
        : ''),
  };
}

/** Reopens a locked week for flagging and pickups. */
export async function unlockWeek(
  weekId: string,
  actorName: string,
): Promise<AdminResult> {
  const w = await loadWeek(weekId);
  if (!w) return { ok: false, message: 'No such week.' };
  if (w.status === 'posted') {
    return { ok: true, message: 'That week is already open.' };
  }

  await db
    .update(weeks)
    .set({ status: 'posted', lockedAt: null })
    .where(eq(weeks.id, weekId));

  await db.insert(events).values({
    action: 'week.unlocked',
    entityType: 'week',
    entityId: weekId,
    actorName,
    summary: `${actorName} reopened the week of ${w.weekStart} for flagging`,
    payload: { weekStart: w.weekStart },
  });

  return { ok: true, message: `Week of ${w.weekStart} is open again.` };
}

/**
 * Deletes a week outright. There is no hidden or half-posted state: a week is
 * either on the board or it does not exist.
 *
 * Refused once the week has begun. People have worked shifts from it by then,
 * and deleting it would erase the record of what they were asked to do.
 */
export async function deleteWeek(
  weekId: string,
  actorName: string,
): Promise<AdminResult> {
  const w = await loadWeek(weekId);
  if (!w) return { ok: false, message: 'No such week.' };

  if (w.weekStart <= today()) {
    return {
      ok: false,
      message:
        `The week of ${w.weekStart} has already started — brothers have worked ` +
        'shifts from it, and deleting it would erase that record. Edit the ' +
        'individual shifts instead.',
    };
  }

  // Hand back every point this week issued before the rows disappear.
  const slotRows = await db
    .select({ id: slotsTable.id })
    .from(slotsTable)
    .where(eq(slotsTable.weekId, weekId));

  if (slotRows.length > 0) {
    const asg = await db
      .select({ id: assignmentsTable.id })
      .from(assignmentsTable)
      .where(
        inArray(
          assignmentsTable.slotId,
          slotRows.map((s) => s.id),
        ),
      );
    for (const a of asg) await unsettleAssignment(a.id);
  }

  await db.delete(weeks).where(eq(weeks.id, weekId));

  await db.insert(events).values({
    action: 'week.deleted',
    entityType: 'week',
    actorName,
    summary: `${actorName} deleted the week of ${w.weekStart}`,
    payload: { weekStart: w.weekStart },
  });

  return {
    ok: true,
    message: `Deleted the week of ${w.weekStart}. Everyone got their points back.`,
  };
}

/* ------------------------------------------------------------------ */
/* Shift-level                                                         */
/* ------------------------------------------------------------------ */

async function shiftContext(assignmentId: string) {
  const [row] = await db
    .select({ assignment: assignmentsTable, slot: slotsTable, week: weeks })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .innerJoin(weeks, eq(slotsTable.weekId, weeks.id))
    .where(eq(assignmentsTable.id, assignmentId))
    .limit(1);
  return row ?? null;
}

/**
 * Replaces who is on a shift outright.
 *
 * Different from a substitute: a substitute is somebody covering, so the
 * original still owes their turn and only the coverer earns the point. A
 * reassignment says the original should never have been on at all - they are
 * removed cleanly and keep their place in the rotation.
 */
export async function reassignShift(
  assignmentId: string,
  newMemberId: string,
  actorName: string,
  opts: { allowAnyClassYear?: boolean } = {},
): Promise<AdminResult> {
  const ctx = await shiftContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  const [next] = await db
    .select()
    .from(members)
    .where(eq(members.id, newMemberId))
    .limit(1);

  if (!next || !next.active) {
    return { ok: false, message: 'That person is not on the active roster.' };
  }

  if (next.id === ctx.assignment.memberId) {
    return { ok: false, message: 'They are already on this shift.' };
  }

  const clash = await db
    .select({ id: assignmentsTable.id })
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.slotId, ctx.assignment.slotId),
        eq(assignmentsTable.memberId, newMemberId),
      ),
    );
  if (clash.length > 0) {
    return { ok: false, message: `${next.name} is already on this shift.` };
  }

  const previousName = await nameOf(ctx.assignment.memberId);

  await unsettleAssignment(assignmentId);
  await db
    .update(assignmentsTable)
    .set({
      memberId: newMemberId,
      status: 'assigned',
      coveredByMemberId: null,
      multiplier: 1,
      isMakeup: false,
    })
    .where(eq(assignmentsTable.id, assignmentId));

  // Credit lands immediately: being on the schedule is what earns the point.
  await settleAssignment(assignmentId);

  await db.insert(events).values({
    action: 'shift.reassigned',
    entityType: 'assignment',
    entityId: assignmentId,
    actorName,
    summary:
      `${actorName} moved ${ctx.slot.meal} on ${ctx.slot.date} from ` +
      `${previousName} to ${next.name}`,
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      from: ctx.assignment.memberId,
      fromName: previousName,
      to: newMemberId,
      toName: next.name,
      weekStatus: ctx.week.status,
    },
  });

  return {
    ok: true,
    message: `${next.name} is on ${ctx.slot.meal} for ${ctx.slot.date} instead of ${previousName}.`,
  };
}

/** Takes somebody off a shift without penalty, leaving the seat open for any brother to pick up. */
export async function removeFromShift(
  assignmentId: string,
  actorName: string,
  closeBounty: boolean = false,
): Promise<AdminResult> {
  const ctx = await shiftContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  const who = await nameOf(ctx.assignment.memberId);

  await unsettleAssignment(assignmentId);
  await db.delete(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));

  await db
    .update(slotsTable)
    .set({ coverBounty: closeBounty ? 0 : 1 })
    .where(eq(slotsTable.id, ctx.assignment.slotId));

  await db.insert(events).values({
    action: 'shift.removed',
    entityType: 'assignment',
    actorName,
    summary:
      `${actorName} took ${who} off ${ctx.slot.meal} on ${ctx.slot.date} without penalty` +
      (closeBounty ? ' and closed the bounty' : ' (seat open for pickup)'),
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      memberId: ctx.assignment.memberId,
      memberName: who,
      closeBounty,
    },
  });

  return {
    ok: true,
    message: `${who} removed from shift (no penalty). ${closeBounty ? 'Bounty closed.' : 'Seat is open for any brother to pick up.'}`,
  };
}

/** Puts somebody onto a slot that has an open seat. */
export async function addToShift(
  slotId: string,
  memberId: string,
  actorName: string,
  opts: { allowAnyClassYear?: boolean; allowOverfill?: boolean } = {},
): Promise<AdminResult> {
  const [slot] = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, slotId))
    .limit(1);
  if (!slot) return { ok: false, message: 'No such shift.' };

  const [person] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!person || !person.active) {
    return { ok: false, message: 'That person is not on the active roster.' };
  }

  const existing = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, slotId));

  if (existing.some((a) => a.memberId === memberId)) {
    return { ok: false, message: `${person.name} is already on this shift.` };
  }

  if (existing.length >= slot.size && !opts.allowOverfill) {
    return {
      ok: false,
      message: `This shift already has its ${slot.size}. Remove somebody first, or allow overfilling.`,
    };
  }

  const [created] = await db
    .insert(assignmentsTable)
    .values({
      slotId,
      memberId,
      status: 'assigned',
      multiplier: 1,
      isMakeup: false,
      rationale: { addedManuallyBy: actorName, addedAt: new Date().toISOString() },
    })
    .returning({ id: assignmentsTable.id });

  await settleAssignment(created.id);

  await db.insert(events).values({
    action: 'shift.added',
    entityType: 'assignment',
    entityId: created.id,
    actorName,
    summary: `${actorName} put ${person.name} on ${slot.meal} for ${slot.date}`,
    payload: { date: slot.date, meal: slot.meal, memberId, memberName: person.name },
  });

  return { ok: true, message: `${person.name} added to ${slot.meal} on ${slot.date}.` };
}

/* ------------------------------------------------------------------ */
/* Reading a week for the management screen                            */
/* ------------------------------------------------------------------ */

export interface ManageSlot {
  slotId: string;
  date: string;
  meal: 'lunch' | 'dinner';
  size: number;
  coverBounty: number;
  /** True when nobody on the roster could fill it that weekday. */
  assignments: {
    id: string;
    memberId: string;
    memberName: string;
    classYear: string;
    status: string;
    coveredByName: string | null;
    multiplier: number;
    isMakeup: boolean;
    /** Set if this person has a standing conflict on this weekday. */
    conflictsWithDay: boolean;
  }[];
}

export async function getWeekForManagement(weekId: string) {
  const week = await loadWeek(weekId);
  if (!week) return null;

  const slotRows = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.weekId, weekId))
    .orderBy(asc(slotsTable.date), asc(slotsTable.meal));

  const asg = slotRows.length
    ? await db
        .select()
        .from(assignmentsTable)
        .where(
          inArray(
            assignmentsTable.slotId,
            slotRows.map((s) => s.id),
          ),
        )
    : [];

  const ids = [
    ...new Set(
      asg.flatMap((a) =>
        [a.memberId, a.coveredByMemberId].filter((x): x is string => Boolean(x)),
      ),
    ),
  ];

  const people = ids.length
    ? await db.select().from(members).where(inArray(members.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  const slots: ManageSlot[] = slotRows.map((s) => ({
    slotId: s.id,
    date: s.date,
    meal: s.meal,
    size: s.size,
    coverBounty: s.coverBounty,
    assignments: asg
      .filter((a) => a.slotId === s.id)
      .map((a) => {
        const p = byId.get(a.memberId);
        return {
          id: a.id,
          memberId: a.memberId,
          memberName: p?.name ?? 'Unknown',
          classYear: p?.classYear ?? '',
          status: a.status,
          coveredByName: a.coveredByMemberId
            ? (byId.get(a.coveredByMemberId)?.name ?? null)
            : null,
          multiplier: a.multiplier,
          isMakeup: a.isMakeup,
          conflictsWithDay: false,
        };
      })
      .sort((x, y) => x.memberName.localeCompare(y.memberName)),
  }));

  return { week, slots, dayIndexOf: dayIndex };
}

/**
 * Cancels/disables kitchen service for a specific slot.
 * Revokes points awarded to assigned members and deletes the slot.
 */
export async function cancelSlotService(
  slotId: string,
  actorName: string,
): Promise<AdminResult> {
  const [slot] = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, slotId))
    .limit(1);
  if (!slot) return { ok: false, message: 'Slot does not exist.' };

  const asgList = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, slotId));

  for (const a of asgList) {
    await unsettleAssignment(a.id);
  }

  await db.delete(slotsTable).where(eq(slotsTable.id, slotId));

  await db.insert(events).values({
    action: 'slot.cancelled',
    entityType: 'slot',
    entityId: slotId,
    actorName,
    summary: `${actorName} cancelled kitchen service for ${slot.meal} on ${slot.date}`,
    payload: { date: slot.date, meal: slot.meal },
  });

  return {
    ok: true,
    message: `Cancelled service for ${slot.meal} on ${slot.date}.`,
  };
}

/**
 * Enables kitchen service for a day/meal combination that was cancelled or missing.
 */
export async function enableSlotService(
  weekId: string,
  date: string,
  meal: 'lunch' | 'dinner',
  actorName: string,
): Promise<AdminResult> {
  const existing = await db
    .select()
    .from(slotsTable)
    .where(
      and(
        eq(slotsTable.weekId, weekId),
        eq(slotsTable.date, date),
        eq(slotsTable.meal, meal),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return { ok: true, message: 'Service is already enabled for this meal.' };
  }

  const defaultSize = meal === 'lunch' ? 2 : 3;
  await db.insert(slotsTable).values({
    weekId,
    date,
    meal,
    size: defaultSize,
    coverBounty: 1,
  });

  await db.insert(events).values({
    action: 'slot.enabled',
    entityType: 'slot',
    entityId: weekId,
    actorName,
    summary: `${actorName} enabled kitchen service for ${meal} on ${date}`,
    payload: { date, meal },
  });

  return {
    ok: true,
    message: `Enabled service for ${meal} on ${date}.`,
  };
}
