'use server';

import { revalidatePath } from 'next/cache';

import { getSession, requireAdmin } from '../../lib/session.ts';
import {
  flagConflict,
  volunteerToCover,
  setAttendance,
  assignSubstitute,
  type ShiftResult,
} from '../../lib/shift-service.ts';
import type { AssignmentStatus } from '../../lib/types.ts';

function refresh() {
  revalidatePath('/schedule');
  revalidatePath('/my-shifts');
  revalidatePath('/admin');
  revalidatePath('/admin/attendance');
}

export async function flagMyShift(
  assignmentId: string,
  reason: string,
): Promise<ShiftResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  const res = await flagConflict(assignmentId, session.sub, reason.trim() || null);
  if (res.ok) refresh();
  return res;
}

export async function coverShift(assignmentId: string): Promise<ShiftResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Sign in first.' };
  if (session.role === 'admin') {
    return {
      ok: false,
      message: 'Use the substitute control to place someone on a shift.',
    };
  }

  const res = await volunteerToCover(assignmentId, session.sub);
  if (res.ok) refresh();
  return res;
}

export async function markAttendance(
  assignmentId: string,
  status: Extract<AssignmentStatus, 'assigned' | 'no-show' | 'excused'>,
): Promise<ShiftResult> {
  const admin = await requireAdmin();
  const res = await setAttendance(assignmentId, status, admin.name);
  if (res.ok) refresh();
  return res;
}

export async function placeSubstitute(
  assignmentId: string,
  substituteId: string,
  multiplier: number,
): Promise<ShiftResult> {
  const admin = await requireAdmin();
  const res = await assignSubstitute(
    assignmentId,
    substituteId,
    multiplier,
    admin.name,
  );
  if (res.ok) refresh();
  return res;
}
