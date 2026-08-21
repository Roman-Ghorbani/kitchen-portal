/**
 * Server-side session helpers for the App Router.
 *
 * Wraps the pure sign/verify functions in auth.ts with Next's cookie store, so
 * that module stays testable without pulling in the framework.
 */

import { cookies } from 'next/headers';

import {
  signSession,
  verifySession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type SessionPayload,
} from './auth.ts';

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export async function setSession(
  payload: Omit<SessionPayload, 'exp'>,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Throws if nobody is signed in. Use in pages that require any identity. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  return session;
}

/** Throws unless the signed-in user is the kitchen manager. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin') throw new Error('Admin only');
  return session;
}
