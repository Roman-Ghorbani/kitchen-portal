'use server';

import { revalidatePath } from 'next/cache';

import { getSession } from '../../lib/session.ts';
import {
  requestLatePlate,
  cancelLatePlate,
  type LatePlateResult,
} from '../../lib/late-plate-service.ts';
import type { Meal } from '../../lib/types.ts';

function refresh() {
  revalidatePath('/late-plate');
}

export async function requestPlate(
  date: string,
  meal: Meal,
  note: string,
  flags: string[],
  flagsOther: string,
): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  const res = await requestLatePlate(session.sub, date, meal, {
    note: note.trim() || null,
    flags,
    flagsOther: flagsOther.trim() || null,
    // What he ticks here becomes his standing set, so next time it is already
    // ticked. That is the whole point of remembering them.
    remember: true,
  });
  if (res.ok) refresh();
  return res;
}

export async function cancelPlate(id: string): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  const res = await cancelLatePlate(id, session.sub);
  if (res.ok) refresh();
  return res;
}


export async function adminPlacePlate(
  memberId: string,
  date: string,
  meal: Meal,
  note: string,
  flags: string[],
  flagsOther: string,
): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return { ok: false, message: 'Admin access required.' };
  }

  const { adminManualRequest } = await import('../../lib/late-plate-service.ts');
  const res = await adminManualRequest(session.name, memberId, date, meal, {
    note,
    flags,
    flagsOther,
  });
  if (res.ok) {
    refresh();
    revalidatePath('/admin/late-plates');
  }
  return res;
}

export async function adminUpdateStatus(
  id: string,
  status: 'waiting' | 'ready' | 'declined' | 'cancelled',
  reason?: string,
): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return { ok: false, message: 'Admin access required.' };
  }

  const { adminOverrideStatus } = await import('../../lib/late-plate-service.ts');
  const res = await adminOverrideStatus(session.name, id, status, reason);
  if (res.ok) {
    refresh();
    revalidatePath('/admin/late-plates');
  }
  return res;
}

export async function addRecurringLatePlate(
  dayOfWeek: number,
  meal: Meal,
  note?: string,
): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  const { setRecurringLatePlate } = await import('../../lib/late-plate-service.ts');
  const res = await setRecurringLatePlate(session.sub, dayOfWeek, meal, note);
  if (res.ok) refresh();
  return res;
}

export async function removeRecurringLatePlate(id: string): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  const { deleteRecurringLatePlate } = await import('../../lib/late-plate-service.ts');
  const res = await deleteRecurringLatePlate(id, session.sub);
  if (res.ok) refresh();
  return res;
}

export async function updateMyDietary(
  flags: string[],
  other: string,
): Promise<LatePlateResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  const { setMemberDietary } = await import('../../lib/late-plate-service.ts');
  const res = await setMemberDietary(session.sub, flags, other);
  if (res.ok) refresh();
  return res;
}
