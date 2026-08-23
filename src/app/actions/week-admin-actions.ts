'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../lib/session.ts';
import {
  lockWeek,
  unlockWeek,
  deleteWeek,
  reassignShift,
  removeFromShift,
  addToShift,
  type AdminResult,
} from '../../lib/week-admin.ts';
import { generateAndSaveWeek } from '../../lib/week-service.ts';

function refresh() {
  revalidatePath('/admin');
  revalidatePath('/admin/week');
  revalidatePath('/schedule');
  revalidatePath('/my-shifts');
}

export async function adminLockWeek(weekId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await lockWeek(weekId, admin.name);
  if (res.ok) refresh();
  return res;
}

export async function adminUnlockWeek(weekId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await unlockWeek(weekId, admin.name);
  if (res.ok) refresh();
  return res;
}

export async function adminDeleteWeek(weekId: string): Promise<AdminResult> {
  const admin = await requireAdmin();
  const res = await deleteWeek(weekId, admin.name);
  if (res.ok) refresh();
  return res;
}

/** Draws and posts a new week. */
export async function adminCreateWeek(weekStart: string): Promise<AdminResult> {
  await requireAdmin();
  try {
    const { assignmentCount, result } = await generateAndSaveWeek(weekStart);
    refresh();
    return {
      ok: true,
      message:
        `Posted the week of ${weekStart} with ${assignmentCount} shifts` +
        (result.unfilled.length > 0
          ? `, ${result.unfilled.length} seat(s) nobody could fill`
          : '') +
        '. The house can see it now.',
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
