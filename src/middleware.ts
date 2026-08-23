import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './lib/session-constants.ts';

/**
 * Keeps a signed-in brother signed in.
 *
 * Renews the session cookie's expiry on every request, so somebody who opens
 * the app even once a month never reaches the end of the window and is never
 * asked for their PIN again. Only the expiry is touched - the signed payload
 * is passed through untouched, so this cannot mint or alter a session, and
 * verification still happens server-side on every page.
 *
 * Deliberately does no crypto: middleware runs on the edge runtime where
 * node:crypto is unavailable, and re-verifying here would buy nothing that
 * the page itself does not already do.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const response = NextResponse.next();

  if (token) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  return response;
}

export const config = {
  // Pages only. No point touching static assets or the cron endpoints.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|api/).*)'],
};
