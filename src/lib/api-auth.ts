/**
 * Who is calling a route handler, and what they may do.
 *
 * Three kinds of caller reach the JSON API:
 *
 *   session  - a signed-in brother or the manager (cookie, revocation-checked)
 *   kiosk    - a paired chef tablet (cookie; see kiosk.ts)
 *   display  - the house display on the Pi, holding TV_API_KEY. Read-only, and
 *              only the /api/tv endpoints, which return names and counts and
 *              nothing about anybody's dietary needs.
 *
 *   read     brother, manager, kiosk
 *   create   brother only, as himself (a late plate request)
 *   write    manager, kiosk
 *
 * Every endpoint is same-origin. Nothing here sends CORS headers: the kiosk
 * is a page on this site, and the display fetches server-to-server, where
 * CORS does not apply.
 */

import { NextRequest, NextResponse } from 'next/server.js';

import { SESSION_COOKIE, KIOSK_COOKIE } from './session-constants.ts';
import { safeEqual, type SessionPayload } from './auth.ts';
import { sessionFromToken } from './session.ts';
import { deviceFromCookie, type KioskDevice } from './kiosk.ts';
import type { ActorRole } from './audit.ts';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export interface Caller {
  session: SessionPayload | null;
  kiosk: KioskDevice | null;
}

export async function callerOf(request: NextRequest): Promise<Caller> {
  const [session, kiosk] = await Promise.all([
    sessionFromToken(request.cookies.get(SESSION_COOKIE)?.value),
    deviceFromCookie(request.cookies.get(KIOSK_COOKIE)?.value),
  ]);
  return { session, kiosk };
}

export function canRead(caller: Caller): boolean {
  return caller.kiosk !== null || caller.session !== null;
}

export function canWrite(caller: Caller): boolean {
  return caller.kiosk !== null || caller.session?.role === 'admin';
}

/** Name and role for the audit log, whoever is acting. */
export function actorOf(caller: Caller): { actorName: string; actorRole: ActorRole } {
  if (caller.session?.role === 'admin') return { actorName: caller.session.name, actorRole: 'manager' };
  if (caller.session) return { actorName: caller.session.name, actorRole: 'brother' };
  if (caller.kiosk) return { actorName: `Kitchen tablet (${caller.kiosk.label})`, actorRole: 'kiosk' };
  return { actorName: 'Unknown', actorRole: 'anonymous' };
}

/**
 * True when the request carries the display key.
 *
 * Header only - `X-API-Key` or `Authorization: Bearer` - never a query
 * parameter, which would end up in access logs. Fails closed: with no key
 * configured nothing is accepted.
 */
export function hasDisplayKey(request: NextRequest): boolean {
  const expected = process.env.TV_API_KEY;
  if (!expected) return false;
  const auth = request.headers.get('authorization');
  const provided =
    request.headers.get('x-api-key') ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : null);
  return provided !== null && safeEqual(provided, expected);
}

export const UNAUTHORIZED = { error: 'Unauthorized' };
