/**
 * GET /kitchen/legacy?token=... - converts a tablet on the old bookmark.
 *
 * Before pairing existed, the tablet's URL carried the kitchen token. If that
 * token still matches, this pairs the tablet on the spot, sets its cookie and
 * redirects to a clean URL so the token leaves the address bar for good. The
 * manager retires the old token from the Late plates page afterwards.
 */

import { NextRequest, NextResponse } from 'next/server.js';

import { exchangeLegacyToken } from '../../../lib/kiosk.ts';
import { KIOSK_COOKIE, KIOSK_COOKIE_TTL_SECONDS } from '../../../lib/session-constants.ts';
import { logEvent } from '../../../lib/audit.ts';
import { checkThrottle, recordFailure, POLICIES } from '../../../lib/throttle.ts';
import { contextFrom } from '../../../lib/request-context.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { ip } = contextFrom(request.headers);
  const target = new URL('/kitchen/late-plates', request.url);
  const token = request.nextUrl.searchParams.get('token') ?? '';

  const gate = await checkThrottle([`pairing:${ip}`, `ip:${ip}`]);
  const paired = gate.allowed && token ? await exchangeLegacyToken(token) : null;

  if (!paired) {
    if (gate.allowed) {
      await recordFailure([
        [`pairing:${ip}`, POLICIES.pairing],
        [`ip:${ip}`, POLICIES.ip],
      ]);
    }
    return NextResponse.redirect(target);
  }

  await logEvent({
    action: 'kiosk.paired',
    entityType: 'kiosk-device',
    entityId: paired.device.id,
    actorRole: 'kiosk',
    actorName: `Kitchen tablet (${paired.device.label})`,
    summary: 'A kitchen tablet on the old bookmarked link was converted to a paired device',
    payload: { ip, legacy: true },
  });

  const response = NextResponse.redirect(target);
  response.cookies.set(KIOSK_COOKIE, paired.cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: KIOSK_COOKIE_TTL_SECONDS,
  });
  return response;
}
