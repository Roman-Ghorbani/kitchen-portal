'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../lib/session.ts';
import {
  runChapterTransition,
  approveReplacement,
  type TransitionResult,
} from '../../lib/chapter-transition.ts';

export async function runChapter(): Promise<TransitionResult> {
  const admin = await requireAdmin();
  const res = await runChapterTransition(admin.name);

  revalidatePath('/admin');
  revalidatePath('/schedule');
  revalidatePath('/my-shifts');

  return res;
}

export async function approveProposedReplacement(
  assignmentId: string,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  const res = await approveReplacement(assignmentId, admin.name);

  revalidatePath('/admin');
  revalidatePath('/schedule');

  return res;
}
