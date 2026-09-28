'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  MENU_AUTH_COOKIE,
  MENU_AUTH_TTL_SECONDS,
  MIN_MENU_PASSWORD_LENGTH,
  verifySeniorMenuPassword,
  setSeniorMenuPassword,
  signMenuToken,
} from '../../lib/senior-menu-auth.ts';
import { requireAdmin } from '../../lib/session.ts';
import { checkThrottle, recordFailure, describeWait, POLICIES } from '../../lib/throttle.ts';
import { requestContext } from '../../lib/request-context.ts';
import { logEvent } from '../../lib/audit.ts';

export interface MenuAuthResult {
  ok: boolean;
  error?: string;
  retryAfterMs?: number;
}

export async function submitMenuPassword(password: string): Promise<MenuAuthResult> {
  const { ip, userAgent } = await requestContext();
  const keys = [`menu:${ip}`, `ip:${ip}`];

  const gate = await checkThrottle(keys);
  if (!gate.allowed) {
    return {
      ok: false,
      error: `Too many incorrect attempts. Try again in ${describeWait(gate.retryAfter)}.`,
      retryAfterMs: gate.retryAfter * 1000,
    };
  }

  if (!(await verifySeniorMenuPassword(password))) {
    const after = await recordFailure([
      [keys[0], POLICIES.menu],
      [keys[1], POLICIES.ip],
    ]);
    await logEvent({
      action: 'auth.menu_password_failed',
      entityType: 'senior-menu',
      actorRole: 'anonymous',
      summary: `Failed Senior Week menu password from ${ip}`,
      payload: { ip, userAgent },
    });
    if (!after.allowed) {
      return {
        ok: false,
        error: `Too many incorrect attempts. Try again in ${describeWait(after.retryAfter)}.`,
        retryAfterMs: after.retryAfter * 1000,
      };
    }
    return {
      ok: false,
      error: `Incorrect password. ${after.remaining} attempt${after.remaining === 1 ? '' : 's'} left before a lockout.`,
    };
  }

  const store = await cookies();
  store.set(MENU_AUTH_COOKIE, await signMenuToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/menu',
    maxAge: MENU_AUTH_TTL_SECONDS,
  });
  revalidatePath('/menu');
  return { ok: true };
}

export async function lockMenuDevice(): Promise<void> {
  const store = await cookies();
  store.delete({ name: MENU_AUTH_COOKIE, path: '/menu' });
  revalidatePath('/menu');
  redirect('/menu');
}

/** Setting a new password signs every device out of the menu. */
export async function updateSeniorMenuPassword(
  newPassword: string,
): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  const trimmed = newPassword.trim();
  if (trimmed.length < MIN_MENU_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_MENU_PASSWORD_LENGTH} characters.` };
  }

  await setSeniorMenuPassword(trimmed);
  await logEvent({
    action: 'settings.senior_menu_password_changed',
    entityType: 'senior-menu',
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} changed the Senior Week menu password (every device signed out)`,
  });
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Password changed. Anyone already viewing the menu will need the new one.' };
}
