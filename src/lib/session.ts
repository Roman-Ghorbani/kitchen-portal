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

/**
 * Which brother the manager is currently looking through, if any.
 *
 * An admin session has no roster identity of its own - `sub` is the literal
 * string 'admin' - so "see what the house sees" has to name a real member.
 * The manager picks one from that brother's record and the choice rides in a
 * cookie until he stops.
 *
 * Read-only by construction rather than by politeness: every write action
 * checks the acting member against the row it is changing, and 'admin' never
 * matches one, so a stray tap fails at the server even though the buttons are
 * hidden too.
 */
export const VIEW_AS_COOKIE = 'zbt_view_as';

export async function getViewAs(): Promise<string | null> {
  const session = await getSession();
  if (session?.role !== 'admin') return null;
  const store = await cookies();
  return store.get(VIEW_AS_COOKIE)?.value ?? null;
}

/** Throws unless the signed-in user is the kitchen manager. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin') throw new Error('Admin only');
  return session;
}
