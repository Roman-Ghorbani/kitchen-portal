/**
 * Everything that happens to a shift after it is posted: flagging a conflict,
 * volunteering to cover, correcting attendance, dropping in a substitute, and
 * settling points.
 *
 * Two rules run through all of it:
 *
 *  1. Claiming a slot is first-come, and two people tapping at the same moment
 *     must not both win. Claims are conditional writes that the database
 *     arbitrates, never read-then-write in application code.
 *
 *  2. Every state change writes an events row. That log is the record that
 *     answers a dispute, so it is appended even when the change is routine.
 */

import { eq, and, sql, inArray, isNull } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../db/schema.ts';
import { settleDelta, type SettleInput } from './settlement.ts';
import { isValidMultiplier, formatPoints, type AssignmentStatus } from './types.ts';

export interface ShiftResult {
  ok: boolean;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Shared lookups                                                      */
/* ------------------------------------------------------------------ */

async function loadAssignmentContext(assignmentId: string) {
  const [row] = await db
    .select({
      assignment: assignmentsTable,
      slot: slotsTable,
      week: weeks,
    })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .innerJoin(weeks, eq(slotsTable.weekId, weeks.id))
    .where(eq(assignmentsTable.id, assignmentId))
    .limit(1);

  return row ?? null;
}

async function memberName(id: string): Promise<string> {
  const [m] = await db
    .select({ name: members.name })
    .from(members)
    .where(eq(members.id, id))
    .limit(1);
  return m?.name ?? 'Unknown';
}

/* ------------------------------------------------------------------ */
/* Flagging a conflict                                                 */
/* ------------------------------------------------------------------ */

/**
 * A brother raises a conflict against his own shift while the week is still
 * open. This opens the seat to the whole house rather than removing the
 * obligation - if nobody takes it, it lands in the approvals queue.
 */
export async function flagConflict(
  assignmentId: string,
  actorMemberId: string,
  reason: string | null,
): Promise<ShiftResult> {
  const ctx = await loadAssignmentContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  if (ctx.assignment.memberId !== actorMemberId) {
    return { ok: false, message: 'You can only flag your own shift.' };
  }

  if (ctx.week.status !== 'posted') {
    return {
      ok: false,
      message:
        'This week is locked — flagging closed at chapter. Contact Roman directly.',
    };
  }

  if (ctx.week.locksAt && new Date() > ctx.week.locksAt) {
    return {
      ok: false,
      message: 'The flag deadline for this week has passed.',
    };
  }

  if (ctx.assignment.status !== 'assigned') {
    return {
      ok: false,
      message: `This shift is already marked "${ctx.assignment.status}".`,
    };
  }

  // Conditional so a double-tap cannot flag twice.
  const updated = await db
    .update(assignmentsTable)
    .set({ status: 'flagged' })
    .where(
      and(
        eq(assignmentsTable.id, assignmentId),
        eq(assignmentsTable.status, 'assigned'),
      ),
    )
    .returning({ id: assignmentsTable.id });

  if (updated.length === 0) {
    return { ok: false, message: 'That shift was just changed. Reload and retry.' };
  }

  // Flagging gives the point back: they are no longer doing this shift.
  // They owe nothing either - they said so in time - so they simply return
  // to the pool at their previous total.
  await settleAssignment(assignmentId);

  const name = await memberName(actorMemberId);

  await db.insert(events).values({
    action: 'shift.flagged',
    entityType: 'assignment',
    entityId: assignmentId,
    actorMemberId,
    actorName: name,
    summary:
      `${name} flagged a conflict for ${ctx.slot.meal} on ${ctx.slot.date}` +
      (reason ? ` — "${reason}"` : ''),
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      reason,
      // Recorded so the log shows they flagged inside the window, not after.
      flaggedAt: new Date().toISOString(),
      deadline: ctx.week.locksAt?.toISOString() ?? null,
    },
  });

  return {
    ok: true,
    message: 'Flagged. The slot is now open for anyone to pick up.',
  };
}

/* ------------------------------------------------------------------ */
/* Volunteering to cover                                               */
/* ------------------------------------------------------------------ */

/**
 * Takes a flagged shift. First-come: the conditional update means only one
 * volunteer can win even if several tap at the same instant.
 *
 * Coverage is open to any active member of any class year - a senior or an
 * exempt officer picking up a shift is exactly the behaviour worth encouraging.
 */
export async function volunteerToCover(
  assignmentId: string,
  volunteerId: string,
): Promise<ShiftResult> {
  const ctx = await loadAssignmentContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  if (ctx.assignment.memberId === volunteerId) {
    return { ok: false, message: 'This is already your shift.' };
  }

  if (ctx.assignment.status !== 'flagged') {
    return {
      ok: false,
      message:
        ctx.assignment.status === 'covered'
          ? 'Someone already picked this up.'
          : 'This shift is not open for coverage.',
    };
  }

  const [volunteer] = await db
    .select()
    .from(members)
    .where(eq(members.id, volunteerId))
    .limit(1);

  if (!volunteer || !volunteer.active) {
    return { ok: false, message: 'You are not on the active roster.' };
  }

  // Already on this same slot? Doubling up on one meal helps nobody.
  const sameSlot = await db
    .select({ id: assignmentsTable.id })
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.slotId, ctx.assignment.slotId),
        eq(assignmentsTable.memberId, volunteerId),
      ),
    );
  if (sameSlot.length > 0) {
    return { ok: false, message: 'You are already on this shift.' };
  }

  const claimed = await db
    .update(assignmentsTable)
    .set({ status: 'covered', coveredByMemberId: volunteerId })
    .where(
      and(
        eq(assignmentsTable.id, assignmentId),
        eq(assignmentsTable.status, 'flagged'),
        isNull(assignmentsTable.coveredByMemberId),
      ),
    )
    .returning({ id: assignmentsTable.id });

  if (claimed.length === 0) {
    return { ok: false, message: 'Someone beat you to it by a second.' };
  }

  // The coverer earns the point from the moment they claim it.
  await settleAssignment(assignmentId);

  const originalName = await memberName(ctx.assignment.memberId);

  await db.insert(events).values({
    action: 'shift.covered',
    entityType: 'assignment',
    entityId: assignmentId,
    actorMemberId: volunteerId,
    actorName: volunteer.name,
    summary: `${volunteer.name} picked up ${originalName}'s ${ctx.slot.meal} on ${ctx.slot.date}`,
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      originalMemberId: ctx.assignment.memberId,
    },
  });

  return { ok: true, message: `You're on ${ctx.slot.meal} for ${ctx.slot.date}.` };
}

/* ------------------------------------------------------------------ */
/* Admin: attendance, substitutes, bounties                            */
/* ------------------------------------------------------------------ */

/**
 * Corrects attendance. Everyone is assumed present, so this is only ever used
 * for exceptions - and it settles immediately so points and make-up debt are
 * correct the moment the correction is made, whenever that happens.
 */
export async function setAttendance(
  assignmentId: string,
  status: Extract<AssignmentStatus, 'assigned' | 'no-show' | 'excused'>,
  adminName: string,
): Promise<ShiftResult> {
  const ctx = await loadAssignmentContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  await db
    .update(assignmentsTable)
    .set({ status })
    .where(eq(assignmentsTable.id, assignmentId));

  const who = await memberName(ctx.assignment.memberId);
  await settleAssignment(assignmentId);

  await db.insert(events).values({
    action: `attendance.${status}`,
    entityType: 'assignment',
    entityId: assignmentId,
    actorName: adminName,
    summary: `${adminName} marked ${who} ${status} for ${ctx.slot.meal} on ${ctx.slot.date}`,
    payload: { date: ctx.slot.date, meal: ctx.slot.meal, status },
  });

  const suffix =
    status === 'no-show'
      ? ` ${who} now owes a make-up shift.`
      : status === 'excused'
        ? ' No make-up owed.'
        : '';

  return { ok: true, message: `Marked ${status}.${suffix}` };
}

/**
 * Drops someone into a shift on the spot and settles their points at the
 * chosen multiplier. The bounty exists so Roman can get somebody to step up
 * immediately when a meal would otherwise go uncleaned.
 */
export async function assignSubstitute(
  assignmentId: string,
  substituteId: string,
  multiplier: number,
  adminName: string,
): Promise<ShiftResult> {
  if (!isValidMultiplier(multiplier)) {
    return { ok: false, message: 'Points must be 1x, 1.5x, 2x, or 3x.' };
  }

  const ctx = await loadAssignmentContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  const [sub] = await db
    .select()
    .from(members)
    .where(eq(members.id, substituteId))
    .limit(1);
  if (!sub || !sub.active) {
    return { ok: false, message: 'That person is not on the active roster.' };
  }
  if (sub.id === ctx.assignment.memberId) {
    return { ok: false, message: 'That is the person already assigned.' };
  }

  await db
    .update(assignmentsTable)
    .set({ status: 'covered', coveredByMemberId: substituteId, multiplier })
    .where(eq(assignmentsTable.id, assignmentId));

  await settleAssignment(assignmentId);

  const originalName = await memberName(ctx.assignment.memberId);

  await db.insert(events).values({
    action: 'shift.substituted',
    entityType: 'assignment',
    entityId: assignmentId,
    actorName: adminName,
    summary:
      `${adminName} put ${sub.name} on ${ctx.slot.meal} for ${ctx.slot.date} ` +
      `in place of ${originalName}` +
      (multiplier > 1 ? ` at ${formatPoints(multiplier)}x points` : ''),
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      substituteId,
      multiplier,
      originalMemberId: ctx.assignment.memberId,
    },
  });

  return {
    ok: true,
    message:
      `${sub.name} is on ${ctx.slot.meal} for ${ctx.slot.date}` +
      (multiplier > 1 ? `, earning ${formatPoints(multiplier)} points.` : '.'),
  };
}

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

/**
 * Brings one assignment's points and make-up debt in line with its current
 * status, applying only the difference from whatever was credited before.
 * Safe to call repeatedly.
 */
export async function settleAssignment(assignmentId: string): Promise<void> {
  const [a] = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, assignmentId))
    .limit(1);

  if (!a) return;

  const input: SettleInput = {
    status: a.status,
    memberId: a.memberId,
    coveredByMemberId: a.coveredByMemberId,
    multiplier: a.multiplier,
    pointsAwarded: a.pointsAwarded,
    debtAwarded: a.debtAwarded,
  };

  const delta = settleDelta(input, a.settledRecipientId);

  for (const [memberId, n] of delta.points) {
    await db
      .update(members)
      .set({ points: sql`${members.points} + ${n}` })
      .where(eq(members.id, memberId));
  }

  for (const [memberId, n] of delta.debt) {
    // Debt must never go negative, which would silently grant a free pass.
    await db
      .update(members)
      .set({ makeupDebt: sql`GREATEST(0, ${members.makeupDebt} + ${n})` })
      .where(eq(members.id, memberId));
  }

  await db
    .update(assignmentsTable)
    .set({
      pointsAwarded: delta.outcome.points,
      debtAwarded: delta.outcome.debt,
      settledRecipientId: delta.outcome.recipientId,
      settledAt: new Date(),
    })
    .where(eq(assignmentsTable.id, assignmentId));

  // lastServedDate drives the "longest since served" tie-break, so it only
  // moves for someone who actually served.
  if (delta.outcome.recipientId) {
    const [slot] = await db
      .select({ date: slotsTable.date })
      .from(slotsTable)
      .where(eq(slotsTable.id, a.slotId))
      .limit(1);

    if (slot) {
      await db
        .update(members)
        .set({
          lastServedDate: sql`GREATEST(COALESCE(${members.lastServedDate}, DATE '1970-01-01'), ${slot.date}::date)`,
        })
        .where(eq(members.id, delta.outcome.recipientId));
    }
  }
}

/** Settles every shift in a week whose date has passed. */
export async function settleWeek(weekId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({ id: assignmentsTable.id, date: slotsTable.date })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .where(eq(slotsTable.weekId, weekId));

  const due = rows.filter((r) => r.date <= today);
  for (const r of due) await settleAssignment(r.id);
  return due.length;
}

/* ------------------------------------------------------------------ */
/* Open slots                                                          */
/* ------------------------------------------------------------------ */

/** Flagged shifts anyone can claim, newest week first. */
export async function getOpenShifts() {
  const rows = await db
    .select({
      assignmentId: assignmentsTable.id,
      status: assignmentsTable.status,
      date: slotsTable.date,
      meal: slotsTable.meal,
      weekStatus: weeks.status,
      originalMemberId: assignmentsTable.memberId,
    })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .innerJoin(weeks, eq(slotsTable.weekId, weeks.id))
    .where(eq(assignmentsTable.status, 'flagged'));

  if (rows.length === 0) return [];

  const names = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(inArray(members.id, [...new Set(rows.map((r) => r.originalMemberId))]));
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  return rows
    .map((r) => ({ ...r, originalName: nameById.get(r.originalMemberId) ?? '—' }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Takes back everything an assignment ever awarded, leaving points and
 * make-up debt exactly as if the shift had never been settled.
 *
 * Needed before an assignment is deleted or handed to somebody else - the
 * points already credited belong to that specific assignment, and dropping
 * the row without reversing them would silently leave the credit behind.
 */
export async function unsettleAssignment(assignmentId: string): Promise<void> {
  const [a] = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, assignmentId))
    .limit(1);

  if (!a) return;

  if (a.settledRecipientId && a.pointsAwarded !== 0) {
    await db
      .update(members)
      .set({ points: sql`GREATEST(0, ${members.points} - ${a.pointsAwarded})` })
      .where(eq(members.id, a.settledRecipientId));
  }

  if (a.debtAwarded !== 0) {
    await db
      .update(members)
      .set({
        makeupDebt: sql`GREATEST(0, ${members.makeupDebt} - ${a.debtAwarded})`,
      })
      .where(eq(members.id, a.memberId));
  }

  await db
    .update(assignmentsTable)
    .set({
      pointsAwarded: 0,
      debtAwarded: 0,
      settledRecipientId: null,
      settledAt: null,
    })
    .where(eq(assignmentsTable.id, assignmentId));

  // Roll lastServedDate back too, recomputed from whatever that person is
  // still credited for. Reversing the points but leaving the date behind
  // makes somebody look recently served when the shift no longer exists,
  // and the tie-break would quietly push them down the queue for it.
  if (a.settledRecipientId) {
    await recomputeLastServed(a.settledRecipientId);
  }
}

/** Derives lastServedDate from the assignments a member is still credited for. */
export async function recomputeLastServed(memberId: string): Promise<void> {
  await db.execute(sql`
    UPDATE members m
    SET last_served_date = (
      SELECT MAX(s.date)
      FROM assignments a
      JOIN slots s ON s.id = a.slot_id
      WHERE a.settled_recipient_id = m.id AND a.points_awarded > 0
    )
    WHERE m.id = ${memberId}
  `);
}

/**
 * Changes what a shift is worth, without changing who is on it.
 *
 * Separate from putting somebody new on a shift because those are two
 * different decisions: who is serving, and what it is worth. Bundling them
 * meant the only way to award extra points was to re-pick the same person.
 */
export async function setShiftPoints(
  assignmentId: string,
  multiplier: number,
  adminName: string,
): Promise<ShiftResult> {
  if (!isValidMultiplier(multiplier)) {
    return { ok: false, message: 'Points must be 1x, 1.5x, 2x, or 3x.' };
  }

  const ctx = await loadAssignmentContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  if (ctx.assignment.multiplier === multiplier) {
    return { ok: true, message: 'Already worth that.' };
  }

  const previous = ctx.assignment.multiplier;

  await db
    .update(assignmentsTable)
    .set({ multiplier })
    .where(eq(assignmentsTable.id, assignmentId));

  // Re-settle so the difference is applied rather than the whole amount again.
  await settleAssignment(assignmentId);

  const serving = ctx.assignment.coveredByMemberId ?? ctx.assignment.memberId;
  const who = await memberName(serving);

  await db.insert(events).values({
    action: 'shift.points_changed',
    entityType: 'assignment',
    entityId: assignmentId,
    actorName: adminName,
    summary:
      `${adminName} set ${ctx.slot.meal} on ${ctx.slot.date} to ` +
      `${formatPoints(multiplier)}x for ${who} (was ${formatPoints(previous)}x)`,
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      from: previous,
      to: multiplier,
      memberId: serving,
    },
  });

  return {
    ok: true,
    message: `${who} now earns ${formatPoints(multiplier)} point${multiplier === 1 ? '' : 's'} for this shift.`,
  };
}
