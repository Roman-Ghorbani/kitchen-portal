'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { requireAdmin, VIEW_AS_COOKIE } from '../../lib/session.ts';

/**
 * Look at the app through one brother's eyes.
 *
 * The manager could previously never see what he was shipping: Home, the late
 * plate page and availability all bounced an admin straight back to /admin.
 */
export async function viewAsMember(memberId: string): Promise<void> {
  await requireAdmin();
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, memberId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Deliberately short. Forgetting you are in somebody else's view and then
    // wondering why the dashboard looks wrong is the obvious failure here.
    maxAge: 60 * 60,
  });
  redirect('/');
}

export async function stopViewingAs(): Promise<void> {
  await requireAdmin();
  const store = await cookies();
  store.delete(VIEW_AS_COOKIE);
  redirect('/admin');
}
