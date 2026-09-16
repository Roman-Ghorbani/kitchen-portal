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

import { randomUUID } from 'node:crypto';

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
import { todayInEastern } from './dates.ts';

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
 * A brother puts his own shift up for grabs.
 *
 * Available on any shift at any time - there is no window and no deadline,
 * because there is no longer a week lock for one to hang off. Asking posts the
 * seat to the board for anyone in the house to claim at whatever the shift is
 * worth, which is 1x unless the kitchen manager has raised it.
 *
 * Asking does NOT release him. The shift stays his, and the point stays with
 * him, until somebody actually takes it. If nobody does and he does not serve,
 * it is a no-show with make-up debt exactly as before. Without that rule a
 * request five minutes before service costs nothing and the kitchen goes
 * uncleaned.
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

  // Settlement is a no-op here by design: a shift put up for grabs is still
  // his, so the point does not move. Re-running it keeps the recorded end
  // state honest if a correction has touched this assignment before.
  await settleAssignment(assignmentId);

  const name = await memberName(actorMemberId);

  await db.insert(events).values({
    action: 'shift.flagged',
    entityType: 'assignment',
    entityId: assignmentId,
    actorMemberId,
    actorName: name,
    summary:
      `${name} put his ${ctx.slot.meal} shift on ${ctx.slot.date} up for grabs` +
      (reason ? ` — "${reason}"` : ''),
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      reason,
      // There is no deadline to be inside of any more, so what the record
      // needs is simply when he asked, and how much notice that gave.
      askedAt: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    message:
      'Posted. Anyone in the house can take it now — it stays yours until somebody does.',
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

  const todayIso = todayInEastern();
  if (ctx.slot.date < todayIso) {
    return {
      ok: false,
      message: 'You cannot pick up an open shift for a day that has already passed.',
    };
  }

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
      .set({ makeupDebt: sql`MAX(0, ${members.makeupDebt} + ${n})` })
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
          lastServedDate: sql`MAX(COALESCE(${members.lastServedDate}, '1970-01-01'), ${slot.date})`,
        })
        .where(eq(members.id, delta.outcome.recipientId));
    }
  }
}

/** Settles every shift in a week whose date has passed. */
export async function settleWeek(weekId: string): Promise<number> {
  const today = todayInEastern();

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
      .set({ points: sql`MAX(0, ${members.points} - ${a.pointsAwarded})` })
      .where(eq(members.id, a.settledRecipientId));
  }

  if (a.debtAwarded !== 0) {
    await db
      .update(members)
      .set({
        makeupDebt: sql`MAX(0, ${members.makeupDebt} - ${a.debtAwarded})`,
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
  db.run(sql`
    UPDATE members
    SET last_served_date = (
      SELECT MAX(s.date)
      FROM assignments a
      JOIN slots s ON s.id = a.slot_id
      WHERE a.settled_recipient_id = members.id AND a.points_awarded > 0
    )
    WHERE id = ${memberId}
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

/* ------------------------------------------------------------------ */
/* Opening a shift for cover                                           */
/* ------------------------------------------------------------------ */

/**
 * The manager opens somebody's shift to the house, optionally offering extra
 * points to get it taken.
 *
 * This is the "he told me he can't make it" path. Doing it here rather than
 * making the brother flag it himself means the record still shows he gave
 * notice - he simply gave it in person. He earns nothing for the shift and
 * owes nothing for it, and returns to the pool at his previous total, so he
 * comes back up in rotation sooner.
 */
export async function openForCover(
  assignmentId: string,
  bounty: number,
  adminName: string,
  reason: string | null,
): Promise<ShiftResult> {
  if (!isValidMultiplier(bounty)) {
    return { ok: false, message: 'Bounty must be 1x, 1.5x, 2x, or 3x.' };
  }

  const ctx = await loadAssignmentContext(assignmentId);
  if (!ctx) return { ok: false, message: 'That shift no longer exists.' };

  if (ctx.assignment.status === 'flagged') {
    // Already open - just adjust what it pays.
    await db
      .update(assignmentsTable)
      .set({ multiplier: bounty })
      .where(eq(assignmentsTable.id, assignmentId));
    return {
      ok: true,
      message: `Already open — now offering ${formatPoints(bounty)}x.`,
    };
  }

  await db
    .update(assignmentsTable)
    .set({ status: 'flagged', multiplier: bounty, coveredByMemberId: null })
    .where(eq(assignmentsTable.id, assignmentId));

  // Hands their provisional point back; nobody holds it until it is claimed.
  await settleAssignment(assignmentId);

  const who = await memberName(ctx.assignment.memberId);

  await db.insert(events).values({
    action: 'shift.opened_for_cover',
    entityType: 'assignment',
    entityId: assignmentId,
    actorName: adminName,
    summary:
      `${adminName} opened ${who}'s ${ctx.slot.meal} on ${ctx.slot.date} for ` +
      `cover at ${formatPoints(bounty)}x` +
      (reason ? ` — "${reason}"` : ''),
    payload: {
      date: ctx.slot.date,
      meal: ctx.slot.meal,
      originalMemberId: ctx.assignment.memberId,
      bounty,
      reason,
      openedByAdmin: true,
    },
  });

  return {
    ok: true,
    message:
      `${who}'s shift is open to the house at ${formatPoints(bounty)}x. ` +
      'Anyone can take it.',
  };
}

/** Sets what an unfilled seat on a shift pays (0 closes the bounty). */
export async function setSlotBounty(
  slotId: string,
  bounty: number,
  adminName: string,
): Promise<ShiftResult> {
  if (bounty !== 0 && !isValidMultiplier(bounty)) {
    return { ok: false, message: 'Bounty must be Closed (0), 1x, 1.5x, 2x, or 3x.' };
  }

  const [slot] = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, slotId))
    .limit(1);
  if (!slot) return { ok: false, message: 'No such shift.' };

  await db
    .update(slotsTable)
    .set({ coverBounty: bounty })
    .where(eq(slotsTable.id, slotId));

  const isClosed = bounty === 0;

  await db.insert(events).values({
    action: isClosed ? 'slot.bounty_closed' : 'slot.bounty_set',
    entityType: 'slot',
    entityId: slotId,
    actorName: adminName,
    summary: isClosed
      ? `${adminName} closed the bounty for open seats on ${slot.meal}, ${slot.date}`
      : `${adminName} offered ${formatPoints(bounty)}x for the open seat on ${slot.meal}, ${slot.date}`,
    payload: { date: slot.date, meal: slot.meal, bounty },
  });

  return {
    ok: true,
    message: isClosed
      ? `Bounty closed. Open seats on this shift are locked from house claim.`
      : `Open seats on that shift now pay ${formatPoints(bounty)}x.`,
  };
}

/**
 * Claims a seat nobody is assigned to.
 *
 * Separate from volunteering to cover a flagged shift: there is no assignment
 * row to update, so this inserts one. The seat count is re-checked inside the
 * same statement that inserts, so two people tapping at once cannot both fill
 * the last seat.
 */
export async function claimOpenSeat(
  slotId: string,
  memberId: string,
): Promise<ShiftResult> {
  const [slot] = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.id, slotId))
    .limit(1);
  if (!slot) return { ok: false, message: 'That shift no longer exists.' };

  if (slot.coverBounty <= 0) {
    return {
      ok: false,
      message: 'The bounty for this open shift is closed by the manager.',
    };
  }

  const todayIso = todayInEastern();
  if (slot.date < todayIso) {
    return {
      ok: false,
      message: 'You cannot pick up an open shift for a day that has already passed.',
    };
  }

  const [person] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!person || !person.active) {
    return { ok: false, message: 'You are not on the active roster.' };
  }

  const existing = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.slotId, slotId));

  if (existing.some((a) => a.memberId === memberId)) {
    return { ok: false, message: 'You are already on this shift.' };
  }
  if (existing.length >= slot.size) {
    return { ok: false, message: 'That shift is already full.' };
  }

  const effectiveMultiplier = slot.coverBounty > 0 ? slot.coverBounty : 1;

  // The seat count is evaluated by the database as part of the insert, so a
  // simultaneous claim cannot slip past a check made a moment earlier.
  const newId = randomUUID();
  const rows = db
    .all<{ id: string }>(sql`
      INSERT INTO assignments (id, slot_id, member_id, status, multiplier, is_makeup, rationale, created_at)
      SELECT ${newId}, ${slotId}, ${memberId}, 'assigned', ${effectiveMultiplier}, 0,
             ${JSON.stringify({ claimedOpenSeat: true, at: new Date().toISOString() })},
             ${Math.floor(Date.now() / 1000)}
      WHERE (SELECT COUNT(*) FROM assignments WHERE slot_id = ${slotId}) < ${slot.size}
      RETURNING id
    `);

  if (rows.length === 0) {
    return { ok: false, message: 'Somebody just took the last seat.' };
  }

  await settleAssignment(rows[0].id);

  await db.insert(events).values({
    action: 'shift.seat_claimed',
    entityType: 'assignment',
    entityId: rows[0].id,
    actorMemberId: memberId,
    actorName: person.name,
    summary:
      `${person.name} claimed an open seat on ${slot.meal}, ${slot.date}` +
      (slot.coverBounty > 1 ? ` at ${formatPoints(slot.coverBounty)}x` : ''),
    payload: { date: slot.date, meal: slot.meal, bounty: slot.coverBounty },
  });

  return {
    ok: true,
    message:
      `You're on ${slot.meal} for ${slot.date}` +
      (slot.coverBounty > 1
        ? `, earning ${formatPoints(slot.coverBounty)} points.`
        : '.'),
  };
}
