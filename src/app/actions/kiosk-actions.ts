'use server';

/**
 * Pairing and revoking chef tablets. See lib/kiosk.ts for the design.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../lib/session.ts';
import {
  startPairing,
  completePairing,
  revokeDevice,
  retireLegacyToken,
  PAIRING_TTL_MINUTES,
} from '../../lib/kiosk.ts';
import { KIOSK_COOKIE, KIOSK_COOKIE_TTL_SECONDS } from '../../lib/session-constants.ts';
import { logEvent } from '../../lib/audit.ts';
import { checkThrottle, recordFailure, describeWait, POLICIES } from '../../lib/throttle.ts';
import { requestContext } from '../../lib/request-context.ts';

export async function startTabletPairing(
  label: string,
): Promise<{ ok: boolean; message: string; code?: string; expiresAt?: string }> {
  const admin = await requireAdmin();
  const { id, code, expiresAt } = await startPairing(label);
  await logEvent({
    action: 'kiosk.pairing_started',
    entityType: 'kiosk-device',
    entityId: id,
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} started pairing a kitchen tablet ("${label.trim() || 'Chef tablet'}")`,
  });
  revalidatePath('/admin/late-plates');
  return {
    ok: true,
    message: `On the tablet, open /kitchen/pair and enter this code within ${PAIRING_TTL_MINUTES} minutes.`,
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function revokeTablet(id: string): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  const device = await revokeDevice(id);
  if (!device) return { ok: false, message: 'That tablet is already revoked.' };
  await logEvent({
    action: 'kiosk.revoked',
    entityType: 'kiosk-device',
    entityId: id,
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} revoked the kitchen tablet "${device.label}"`,
  });
  revalidatePath('/admin/late-plates');
  return { ok: true, message: `"${device.label}" can no longer reach the kitchen screen.` };
}

export async function retireLegacyLink(): Promise<{ ok: boolean; message: string }> {
  const admin = await requireAdmin();
  await retireLegacyToken();
  await logEvent({
    action: 'kiosk.legacy_link_retired',
    entityType: 'semester',
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} retired the old bookmarked kitchen link`,
  });
  revalidatePath('/admin/late-plates');
  return { ok: true, message: 'The old ?device= link no longer works.' };
}

/** Runs on the tablet itself, from /kitchen/pair. */
export async function pairTablet(code: string): Promise<{ ok: boolean; error?: string }> {
  const { ip, userAgent } = await requestContext();
  const keys = [`pairing:${ip}`, `ip:${ip}`];

  const gate = await checkThrottle(keys);
  if (!gate.allowed) {
    return { ok: false, error: `Too many attempts. Try again in ${describeWait(gate.retryAfter)}.` };
  }

  const paired = await completePairing(code);
  if (!paired) {
    await recordFailure([
      [keys[0], POLICIES.pairing],
      [keys[1], POLICIES.ip],
    ]);
    await logEvent({
      action: 'kiosk.pairing_failed',
      entityType: 'kiosk-device',
      actorRole: 'anonymous',
      summary: `Failed tablet pairing attempt from ${ip}`,
      payload: { ip, userAgent },
    });
    return { ok: false, error: 'That code is not valid. Codes expire after 15 minutes.' };
  }

  await logEvent({
    action: 'kiosk.paired',
    entityType: 'kiosk-device',
    entityId: paired.device.id,
    actorRole: 'kiosk',
    actorName: `Kitchen tablet (${paired.device.label})`,
    summary: `Kitchen tablet "${paired.device.label}" was paired`,
    payload: { ip, userAgent },
  });

  (await cookies()).set(KIOSK_COOKIE, paired.cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: KIOSK_COOKIE_TTL_SECONDS,
  });
  redirect('/kitchen/late-plates');
}
