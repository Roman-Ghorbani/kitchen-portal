'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../lib/session.ts';
import {
  unpublishWeek,
  republishWeek,
  deleteWeek,
  reassignShift,
  swapShifts,
  removeFromShift,
  addToShift,
  type AdminResult,
} from '../../lib/week-admin.ts';
import { generateAndSaveWeek } from '../../lib/week-service.ts';
import { chapterLockFor } from '../../lib/dates.ts';

function refresh() {
  revalidatePath('/admin');
  revalidatePath('/admin/week');
  revalidatePath('/schedule');
  revalidatePath('/my-shifts');
}

export async function adminUnpublishWeek(weekId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await unpublishWeek(weekId, admin.name);
  if (res.ok) refresh();
  return res;
}

export async function adminRepublishWeek(
  weekId: string,
  weekStart: string,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await republishWeek(
    weekId,
    admin.name,
    new Date(`${chapterLockFor(weekStart)}T23:59:59Z`),
  );
  if (res.ok) refresh();
  return res;
}

export async function adminDeleteWeek(weekId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await deleteWeek(weekId, admin.name);
  if (res.ok) refresh();
  return res;
}

/** Throws away a draft and draws it again from the current roster. */
export async function adminRegenerateWeek(
  weekStart: string,
): Promise<AdminResult> {
  await requireAdmin();
  try {
    const { assignmentCount, result } = await generateAndSaveWeek(weekStart);
    refresh();
    return {
      ok: true,
      message:
        `Redrew the week of ${weekStart} with ${assignmentCount} assignments` +
        (result.unfilled.length > 0
          ? `, ${result.unfilled.length} slot(s) short`
          : '') +
        '. It is still a draft — post it when you are happy.',
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function adminReassign(
  assignmentId: string,
  newMemberId: string,
  allowAnyClassYear: boolean,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await reassignShift(assignmentId, newMemberId, admin.name, {
    allowAnyClassYear,
  });
  if (res.ok) refresh();
  return res;
}

export async function adminSwap(aId: string, bId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await swapShifts(aId, bId, admin.name);
  if (res.ok) refresh();
  return res;
}

export async function adminRemove(assignmentId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await removeFromShift(assignmentId, admin.name);
  if (res.ok) refresh();
  return res;
}

export async function adminAdd(
  slotId: string,
  memberId: string,
  allowAnyClassYear: boolean,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await addToShift(slotId, memberId, admin.name, {
    allowAnyClassYear,
  });
  if (res.ok) refresh();
  return res;
}
