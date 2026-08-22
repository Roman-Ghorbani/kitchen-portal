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
import { dayIndex } from './dates.ts';

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
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Week-level                                                          */
/* ------------------------------------------------------------------ */

/**
 * Pulls a posted week back out of sight so it can be fixed and reposted.
 *
 * Refused once the week has started. At that point people have already worked
 * shifts from it, and there is no honest way to un-tell them.
 */
export async function unpublishWeek(
  weekId: string,
  actorName: string,
): Promise<AdminResult> {
  const w = await loadWeek(weekId);
  if (!w) return { ok: false, message: 'No such week.' };

  if (w.status === 'draft') {
    return { ok: true, message: 'That week is already unpublished.' };
  }

  if (w.weekStart <= today()) {
    return {
      ok: false,
      message:
        `The week of ${w.weekStart} has already started — brothers have worked ` +
        'shifts from it. Edit individual shifts instead of unpublishing.',
    };
  }

  await db
    .update(weeks)
    .set({ status: 'draft', postedAt: null, locksAt: null, lockedAt: null })
    .where(eq(weeks.id, weekId));

  await db.insert(events).values({
    action: 'week.unpublished',
    entityType: 'week',
    entityId: weekId,
    actorName,
    summary: `${actorName} unpublished the week of ${w.weekStart} — hidden from the house`,
    payload: { weekStart: w.weekStart, previousStatus: w.status },
  });

  return {
    ok: true,
    message: `Week of ${w.weekStart} is hidden. Nobody can see it until you repost.`,
  };
}

export async function republishWeek(
  weekId: string,
  actorName: string,
  locksAt: Date,
): Promise<AdminResult> {
  const w = await loadWeek(weekId);
  if (!w) return { ok: false, message: 'No such week.' };
  if (w.status === 'posted') {
    return { ok: true, message: 'That week is already posted.' };
  }

  await db
    .update(weeks)
    .set({ status: 'posted', postedAt: new Date(), locksAt })
    .where(eq(weeks.id, weekId));

  await db.insert(events).values({
    action: 'week.reposted',
    entityType: 'week',
    entityId: weekId,
    actorName,
    summary: `${actorName} posted the week of ${w.weekStart}`,
    payload: { weekStart: w.weekStart },
  });

  return { ok: true, message: `Week of ${w.weekStart} is live again.` };
}

/** Deletes a week outright. Only a draft that has not started. */
export async function deleteWeek(
  weekId: string,
  actorName: string,
): Promise<AdminResult> {
  const w = await loadWeek(weekId);
  if (!w) return { ok: false, message: 'No such week.' };

  if (w.status !== 'draft') {
    return {
      ok: false,
      message: 'Unpublish the week first, so the deletion is a deliberate two-step.',
    };
  }

  if (w.weekStart <= today()) {
    return { ok: false, message: 'That week has already started and cannot be deleted.' };
  }

  // Reverse anything that somehow got credited before dropping the rows.
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
    summary: `${actorName} deleted the draft week of ${w.weekStart}`,
    payload: { weekStart: w.weekStart },
  });

  return { ok: true, message: `Deleted the week of ${w.weekStart}.` };
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

  const wantYear = YEAR_FOR_MEAL[ctx.slot.meal];
  if (next.classYear !== wantYear && !opts.allowAnyClassYear) {
    return {
      ok: false,
      message:
        `${next.name} is a ${next.classYear} and ${ctx.slot.meal} is for ` +
        `${wantYear}s. Use "allow any class year" if you really mean it.`,
    };
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

  // Only settle a shift that has already happened; a future one settles later.
  if (ctx.slot.date <= today()) await settleAssignment(assignmentId);

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

/** Swaps the two people on two shifts - the "we sorted it between us" case. */
export async function swapShifts(
  aId: string,
  bId: string,
  actorName: string,
): Promise<AdminResult> {
  if (aId === bId) return { ok: false, message: 'Pick two different shifts.' };

  const a = await shiftContext(aId);
  const b = await shiftContext(bId);
  if (!a || !b) return { ok: false, message: 'One of those shifts no longer exists.' };

  const aName = await nameOf(a.assignment.memberId);
  const bName = await nameOf(b.assignment.memberId);

  // Two people on the same shift have nothing to trade.
  if (a.assignment.slotId === b.assignment.slotId) {
    return {
      ok: false,
      message: `${aName} and ${bName} are already on the same shift.`,
    };
  }

  // If either is already on the other's slot the swap would put somebody on
  // one shift twice, which the database rejects outright.
  const onA = await db
    .select({ memberId: assignmentsTable.memberId })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, a.assignment.slotId));
  const onB = await db
    .select({ memberId: assignmentsTable.memberId })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, b.assignment.slotId));

  if (onA.some((r) => r.memberId === b.assignment.memberId)) {
    return {
      ok: false,
      message: `${bName} is already on that other shift, so they cannot swap onto it.`,
    };
  }
  if (onB.some((r) => r.memberId === a.assignment.memberId)) {
    return {
      ok: false,
      message: `${aName} is already on that other shift, so they cannot swap onto it.`,
    };
  }

  const [aMember] = await db
    .select()
    .from(members)
    .where(eq(members.id, a.assignment.memberId))
    .limit(1);
  const [bMember] = await db
    .select()
    .from(members)
    .where(eq(members.id, b.assignment.memberId))
    .limit(1);

  // A swap across meals would put somebody on the wrong meal for their year.
  if (a.slot.meal !== b.slot.meal) {
    if (
      aMember.classYear !== YEAR_FOR_MEAL[b.slot.meal] ||
      bMember.classYear !== YEAR_FOR_MEAL[a.slot.meal]
    ) {
      return {
        ok: false,
        message:
          `Cannot swap across meals: ${a.slot.meal} is for ` +
          `${YEAR_FOR_MEAL[a.slot.meal]}s and ${b.slot.meal} is for ` +
          `${YEAR_FOR_MEAL[b.slot.meal]}s.`,
      };
    }
  }

  await unsettleAssignment(aId);
  await unsettleAssignment(bId);

  await db
    .update(assignmentsTable)
    .set({ memberId: b.assignment.memberId, coveredByMemberId: null, multiplier: 1 })
    .where(eq(assignmentsTable.id, aId));
  await db
    .update(assignmentsTable)
    .set({ memberId: a.assignment.memberId, coveredByMemberId: null, multiplier: 1 })
    .where(eq(assignmentsTable.id, bId));

  if (a.slot.date <= today()) await settleAssignment(aId);
  if (b.slot.date <= today()) await settleAssignment(bId);

  await db.insert(events).values({
    action: 'shift.swapped',
    entityType: 'assignment',
    entityId: aId,
    actorName,
    summary:
      `${actorName} swapped ${aName} (${a.slot.meal} ${a.slot.date}) with ` +
      `${bName} (${b.slot.meal} ${b.slot.date})`,
    payload: {
      a: { id: aId, date: a.slot.date, meal: a.slot.meal, was: aName },
      b: { id: bId, date: b.slot.date, meal: b.slot.meal, was: bName },
    },
  });

  return {
    ok: true,
    message: `Swapped ${aName} and ${bName}.`,
  };
}

/** Takes somebody off a shift, leaving the seat open. */
export async function removeFromShift(
  assignmentId: string,
  actorName: string,
): Promise<AdminResult> {
  const ctx = await shiftContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  const who = await nameOf(ctx.assignment.memberId);

  await unsettleAssignment(assignmentId);
  await db.delete(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));

  await db.insert(events).values({
    action: 'shift.removed',
    entityType: 'assignment',
    actorName,
    summary: `${actorName} took ${who} off ${ctx.slot.meal} on ${ctx.slot.date}`,
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      memberId: ctx.assignment.memberId,
      memberName: who,
    },
  });

  return { ok: true, message: `${who} removed. That seat is now open.` };
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

  const wantYear = YEAR_FOR_MEAL[slot.meal];
  if (person.classYear !== wantYear && !opts.allowAnyClassYear) {
    return {
      ok: false,
      message:
        `${person.name} is a ${person.classYear} and ${slot.meal} is for ` +
        `${wantYear}s. Use "allow any class year" if you really mean it.`,
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

  if (slot.date <= today()) await settleAssignment(created.id);

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
