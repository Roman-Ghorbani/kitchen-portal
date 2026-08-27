/**
 * Shared plumbing for the /api/late-plates endpoints.
 *
 * Who is allowed to do what:
 *
 *   read   - a signed-in brother, an admin, or a device holding the token
 *   create - a signed-in brother only, acting as himself
 *   write  - an admin, or a device holding the token
 *
 * The device token exists because the chefs will never log in. It is a long
 * random string baked into the tablet's bookmarked URL, and it is not real
 * security: anyone who reads the tablet's address bar has it. The threat model
 * is a brother marking his own plate ready as a joke, not an attacker - and
 * the cost of a stronger scheme is that the chefs stop using the thing. Rotate
 * it if it leaks; keep it in the environment, never in git.
 */

import { NextRequest, NextResponse } from 'next/server.js';
import { timingSafeEqual } from 'node:crypto';

import { verifySession, SESSION_COOKIE, type SessionPayload } from './auth.ts';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

import { getActiveSemester } from './week-service.ts';

/**
 * True when the request carries the kitchen device token.
 *
 * Accepted as `?device=`, `X-API-Key`, or a bearer header, so the same token
 * works from a bookmarked kiosk URL and from curl. Always false when the token
 * is not configured - an unset secret disables token access rather than
 * opening the endpoint to everybody, which is the failure mode that matters.
 */
export async function hasDeviceToken(request: NextRequest): Promise<boolean> {
  const semester = await getActiveSemester().catch(() => null);
  const expected = semester?.kioskToken || process.env.LATE_PLATE_DEVICE_TOKEN;
  if (!expected) return false;

  const auth = request.headers.get('authorization');
  const provided =
    request.nextUrl.searchParams.get('device') ??
    request.headers.get('x-api-key') ??
    (auth?.startsWith('Bearer ') ? auth.slice(7) : null);

  return provided !== null && constantTimeEquals(provided, expected);
}

/** The signed-in user, read straight off the cookie. Null when signed out. */
export function sessionFrom(request: NextRequest): SessionPayload | null {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

export interface Caller {
  session: SessionPayload | null;
  device: boolean;
}

export async function callerOf(request: NextRequest): Promise<Caller> {
  return { session: sessionFrom(request), device: await hasDeviceToken(request) };
}

export function canRead(caller: Caller): boolean {
  return caller.device || caller.session !== null;
}

export function canWrite(caller: Caller): boolean {
  return caller.device || caller.session?.role === 'admin';
}

/** A name for the audit log, whoever is acting. */
export function actorNameOf(caller: Caller): string {
  if (caller.session) return caller.session.name;
  return 'Kitchen tablet';
}

export const UNAUTHORIZED = { error: 'Unauthorized' };
