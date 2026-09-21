'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  MENU_AUTH_COOKIE,
  MENU_AUTH_TTL_SECONDS,
  getClientIp,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  verifySeniorMenuPassword,
  signMenuToken,
} from '../../lib/senior-menu-auth.ts';
import { requireAdmin } from '../../lib/session.ts';
import { updateTvSettings } from '../../lib/tv-service.ts';

export interface MenuAuthResult {
  ok: boolean;
  error?: string;
  locked?: boolean;
  retryAfterMs?: number;
  remainingAttempts?: number;
}

export async function submitMenuPassword(password: string): Promise<MenuAuthResult> {
  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  // Check rate limit on server by IP (protects across incognito and cookie clears)
  const limit = checkRateLimit(clientIp);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterMs / (60 * 1000));
    return {
      ok: false,
      error: `Too many incorrect attempts. Access from this device is temporarily blocked for ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      locked: true,
      retryAfterMs: limit.retryAfterMs,
    };
  }

  const valid = await verifySeniorMenuPassword(password);
  if (!valid) {
    const attempt = recordFailedAttempt(clientIp);
    if (attempt.locked) {
      const minutes = Math.ceil(attempt.retryAfterMs / (60 * 1000));
      return {
        ok: false,
        error: `Too many incorrect attempts. Access from this device is blocked for ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        locked: true,
        retryAfterMs: attempt.retryAfterMs,
      };
    }

    return {
      ok: false,
      error: `Incorrect password. ${attempt.remainingAttempts} attempt${attempt.remainingAttempts === 1 ? '' : 's'} remaining before a 10-minute lockout.`,
      remainingAttempts: attempt.remainingAttempts,
    };
  }

  // Password is correct: clear failed attempts and set persistent 10-year cookie
  clearRateLimit(clientIp);

  const cookieStore = await cookies();
  cookieStore.set(MENU_AUTH_COOKIE, signMenuToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MENU_AUTH_TTL_SECONDS,
  });

  revalidatePath('/menu');
  return { ok: true };
}

export async function lockMenuDevice(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(MENU_AUTH_COOKIE);
  revalidatePath('/menu');
  redirect('/menu');
}

export async function updateSeniorMenuPassword(newPassword: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const trimmed = newPassword.trim();
  if (!trimmed || trimmed.length < 3) {
    return { ok: false, message: 'Password must be at least 3 characters long.' };
  }

  await updateTvSettings({ seniorMenuPassword: trimmed });
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Senior menu password updated successfully.' };
}
