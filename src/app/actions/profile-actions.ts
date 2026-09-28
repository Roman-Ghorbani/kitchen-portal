'use server';

import { revalidatePath } from 'next/cache';

import { getSession } from '../../lib/session.ts';
import { updateOwnProfile, type RosterResult } from '../../lib/roster-service.ts';

/** A brother saving his own room and Slack ID. */
export async function updateMyProfile(room: string, slackUserId: string): Promise<RosterResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') return { ok: false, message: 'Sign in first.' };
  const res = await updateOwnProfile(session.sub, { room, slackUserId });
  if (res.ok) revalidatePath('/profile');
  return res;
}
