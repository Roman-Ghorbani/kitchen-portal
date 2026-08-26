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
