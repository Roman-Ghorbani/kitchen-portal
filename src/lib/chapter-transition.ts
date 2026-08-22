/**
 * The Sunday chapter transition.
 *
 * Three things happen at chapter, in this order:
 *
 *  1. Any shift still flagged with nobody volunteering gets an auto-suggested
 *     replacement, which lands in the approvals queue rather than being
 *     applied silently - Roman decides, but he decides from a proposal rather
 *     than a blank page.
 *  2. The open week locks. Flagging closes; the record of who was told what
 *     is now fixed.
 *  3. A fresh week is generated and posted 8 days out, giving it a full 7-day
 *     flag window before it runs.
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
import { generateAndSaveWeek, getActiveSemester, loadSchedulingRoster } from './week-service.ts';
import { settleWeek } from './shift-service.ts';
import { dayIndex, chapterLockFor, weekDueForPosting } from './dates.ts';
import { YEAR_FOR_MEAL } from './types.ts';

export interface TransitionResult {
  ok: boolean;
  message: string;
  lockedWeek?: string;
  postedWeek?: string;
  unresolved?: number;
  proposals?: { assignmentId: string; date: string; meal: string; suggested: string }[];
}

/**
 * Suggests a replacement for every shift still flagged in a week.
 *
 * Uses the same lowest-points-first logic as normal generation, but does not
 * apply it - the suggestion is recorded on the assignment and surfaced for
 * approval.
 */
export async function proposeReplacements(weekId: string) {
  const semester = await getActiveSemester();
  const roster = await loadSchedulingRoster(semester.id);

  const flagged = await db
    .select({
      assignment: assignmentsTable,
      slot: slotsTable,
    })
    .from(assignmentsTable)
    .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
    .where(
      and(eq(slotsTable.weekId, weekId), eq(assignmentsTable.status, 'flagged')),
    );

  if (flagged.length === 0) return [];

  // Who is already on each day, so a replacement is not double-booked.
  const weekSlots = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.weekId, weekId));

  const weekAssignments = await db
    .select()
    .from(assignmentsTable)
    .where(
      inArray(
        assignmentsTable.slotId,
        weekSlots.map((s) => s.id),
      ),
    );

  const slotDate = new Map(weekSlots.map((s) => [s.id, s.date]));
  const busyThisWeek = new Set<string>();
  const busyByDate = new Map<string, Set<string>>();

  for (const a of weekAssignments) {
    if (a.status === 'flagged') continue;
    const who = a.coveredByMemberId ?? a.memberId;
    busyThisWeek.add(who);
    const d = slotDate.get(a.slotId)!;
    if (!busyByDate.has(d)) busyByDate.set(d, new Set());
    busyByDate.get(d)!.add(who);
  }

  const proposals: {
    assignmentId: string;
    date: string;
    meal: string;
    suggestedId: string;
    suggestedName: string;
  }[] = [];

  for (const f of flagged) {
    const wantYear = YEAR_FOR_MEAL[f.slot.meal];
    const day = dayIndex(f.slot.date);

    const candidates = roster
      .filter(
        (m) =>
          !m.exempt &&
          m.classYear === wantYear &&
          !m.standingConflicts.includes(day) &&
          !busyThisWeek.has(m.id) &&
          m.id !== f.assignment.memberId,
      )
      .sort(
        (a, b) =>
          b.makeupDebt - a.makeupDebt ||
          a.points - b.points ||
          (a.lastServedDate ?? '').localeCompare(b.lastServedDate ?? '') ||
          a.name.localeCompare(b.name),
      );

    if (candidates.length === 0) continue;

    const pick = candidates[0];
    busyThisWeek.add(pick.id);

    proposals.push({
      assignmentId: f.assignment.id,
      date: f.slot.date,
      meal: f.slot.meal,
      suggestedId: pick.id,
      suggestedName: pick.name,
    });

    // Recorded on the assignment so the approvals queue can show it without
    // recomputing, and so the proposal is part of the permanent record.
    await db
      .update(assignmentsTable)
      .set({
        rationale: {
          ...(f.assignment.rationale as object | null),
          proposedReplacementId: pick.id,
          proposedReplacementName: pick.name,
          proposedAt: new Date().toISOString(),
        },
      })
      .where(eq(assignmentsTable.id, f.assignment.id));
  }

  return proposals;
}

/**
 * Runs the whole transition. Safe to call more than once on the same day -
 * a week already locked is not re-locked, and a week already posted is not
 * regenerated.
 */
export async function runChapterTransition(
  actorName: string,
): Promise<TransitionResult> {
  const semester = await getActiveSemester();

  const all = await db
    .select()
    .from(weeks)
    .where(eq(weeks.semesterId, semester.id))
    .orderBy(asc(weeks.weekStart));

  if (all.length === 0) {
    return { ok: false, message: 'No weeks exist yet. Post the first week first.' };
  }

  const today = new Date().toISOString().slice(0, 10);

  /* ---- 1. propose replacements for anything still flagged ---- */
  const openWeek = all.find((w) => w.status === 'posted');
  let proposals: Awaited<ReturnType<typeof proposeReplacements>> = [];

  if (openWeek) {
    proposals = await proposeReplacements(openWeek.id);
  }

  /* ---- 2. lock any posted week whose deadline has passed ---- */
  let lockedWeek: string | undefined;

  for (const w of all) {
    if (w.status !== 'posted') continue;
    const lockDate = chapterLockFor(w.weekStart);
    if (today < lockDate) continue;

    await db
      .update(weeks)
      .set({ status: 'locked', lockedAt: new Date() })
      .where(eq(weeks.id, w.id));

    await db.insert(events).values({
      action: 'week.locked',
      entityType: 'week',
      entityId: w.id,
      actorName,
      summary:
        `Week of ${w.weekStart} locked at chapter` +
        (proposals.length > 0
          ? ` with ${proposals.length} replacement(s) awaiting approval`
          : ' with no unresolved conflicts'),
      payload: { weekStart: w.weekStart, proposals },
    });

    lockedWeek = w.weekStart;
  }

  /* ---- 3. settle anything that has already been served ---- */
  for (const w of all) {
    if (w.status === 'locked' || w.status === 'complete') {
      await settleWeek(w.id);
    }
  }

  /* ---- 4. post whichever week the cadence is due to post ---- */
  // Driven by today's date rather than by the latest existing week, so
  // running this twice in one day cannot post weeks arbitrarily far ahead.
  const nextWeekStart = weekDueForPosting(today);
  const alreadyExists = all.some((w) => w.weekStart === nextWeekStart);
  let postedWeek: string | undefined;

  if (!alreadyExists && nextWeekStart <= semester.endsOn) {
    await generateAndSaveWeek(nextWeekStart, { post: true });
    postedWeek = nextWeekStart;
  }

  const parts: string[] = [];
  if (lockedWeek) parts.push(`locked the week of ${lockedWeek}`);
  if (proposals.length > 0) {
    parts.push(`${proposals.length} replacement(s) need your approval`);
  }
  if (postedWeek) parts.push(`posted the week of ${postedWeek}`);
  if (parts.length === 0) parts.push('nothing was due — everything is up to date');

  return {
    ok: true,
    message: parts.join('; ') + '.',
    lockedWeek,
    postedWeek,
    unresolved: proposals.length,
    proposals: proposals.map((p) => ({
      assignmentId: p.assignmentId,
      date: p.date,
      meal: p.meal,
      suggested: p.suggestedName,
    })),
  };
}

/** Applies a proposed replacement after Roman approves it. */
export async function approveReplacement(
  assignmentId: string,
  actorName: string,
): Promise<{ ok: boolean; message: string }> {
  const [a] = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, assignmentId))
    .limit(1);

  if (!a) return { ok: false, message: 'That shift no longer exists.' };

  const rationale = a.rationale as { proposedReplacementId?: string } | null;
  const replacementId = rationale?.proposedReplacementId;

  if (!replacementId) {
    return { ok: false, message: 'No replacement was proposed for this shift.' };
  }

  if (a.status !== 'flagged') {
    return { ok: false, message: 'This shift is no longer open.' };
  }

  await db
    .update(assignmentsTable)
    .set({ status: 'covered', coveredByMemberId: replacementId })
    .where(eq(assignmentsTable.id, assignmentId));

  const [who] = await db
    .select({ name: members.name })
    .from(members)
    .where(eq(members.id, replacementId))
    .limit(1);

  await db.insert(events).values({
    action: 'replacement.approved',
    entityType: 'assignment',
    entityId: assignmentId,
    actorName,
    summary: `${actorName} approved ${who?.name ?? 'a replacement'} to cover a flagged shift`,
    payload: { replacementId },
  });

  return { ok: true, message: `${who?.name ?? 'Replacement'} is on the shift.` };
}
