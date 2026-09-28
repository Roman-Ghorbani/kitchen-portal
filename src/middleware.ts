import { NextResponse, type NextRequest } from 'next/server';

import {
  SESSION_COOKIE,
  KIOSK_COOKIE,
  BROTHER_SESSION_TTL_SECONDS,
  KIOSK_COOKIE_TTL_SECONDS,
} from './lib/session-constants.ts';

/**
 * Keeps long-lived cookies alive by renewing their expiry on each page load.
 *
 * Only the cookie's lifetime changes; the value passes through untouched, so
 * this cannot mint or alter a credential, and every page still verifies the
 * session (signature, expiry and revocation) on the server. A manager session
 * is left alone - it is meant to end after a working day.
 *
 * No crypto here: middleware runs on the edge runtime, where node:crypto is
 * unavailable. Reading the role is a base64 decode of the unverified payload,
 * used only to decide whether to extend a cookie, never to grant anything.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const secure = process.env.NODE_ENV === 'production';

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && roleOf(session) === 'brother') {
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: BROTHER_SESSION_TTL_SECONDS,
    });
  }

  const kiosk = request.cookies.get(KIOSK_COOKIE)?.value;
  if (kiosk && request.nextUrl.pathname.startsWith('/kitchen')) {
    response.cookies.set(KIOSK_COOKIE, kiosk, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: KIOSK_COOKIE_TTL_SECONDS,
    });
  }

  return response;
}

function roleOf(token: string): string | null {
  try {
    const body = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(body)) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export const config = {
  // Pages only; API routes and static assets have no use for renewal.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|api/).*)'],
};
