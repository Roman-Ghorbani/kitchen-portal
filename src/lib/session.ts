/**
 * Server-side sessions for the App Router.
 *
 * auth.ts proves a cookie was signed by this server and has not expired. This
 * module adds the part that needs the database: is the session still current?
 * A brother's session must match his row's `session_version` and he must still
 * be on the roster; the manager's must match `admin.sessionVersion`. Changing a
 * PIN, resetting one, or pressing "sign out everywhere" bumps the version, and
 * every cookie issued before that stops working on its next request.
 */

import { cookies } from 'next/headers.js';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { members } from '../db/schema.ts';
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  BROTHER_SESSION_TTL_SECONDS,
  adminCredentialFingerprint,
  type SessionPayload,
} from './auth.ts';
import { adminSessionVersion } from './app-settings.ts';

export const ADMIN_NAME = 'Kitchen Manager';

/** True if a signature-valid session has not been revoked since it was issued. */
export async function isCurrent(session: SessionPayload): Promise<boolean> {
  const ver = session.ver ?? 0;
  if (session.role === 'admin') {
    return (
      session.sub === 'admin' &&
      session.cf === adminCredentialFingerprint() &&
      ver === (await adminSessionVersion())
    );
  }
  const [row] = await db
    .select({ active: members.active, version: members.sessionVersion })
    .from(members)
    .where(eq(members.id, session.sub))
    .limit(1);
  return Boolean(row?.active) && row.version === ver;
}

/** Verify a raw cookie value all the way: signature, expiry, revocation. */
export async function sessionFromToken(token: string | undefined): Promise<SessionPayload | null> {
  const session = verifySession(token);
  if (!session) return null;
  return (await isCurrent(session)) ? session : null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return sessionFromToken(store.get(SESSION_COOKIE)?.value);
}

export async function setSession(payload: Omit<SessionPayload, 'exp' | 'iat'>): Promise<void> {
  const store = await cookies();
  const ttl = payload.role === 'admin' ? ADMIN_SESSION_TTL_SECONDS : BROTHER_SESSION_TTL_SECONDS;
  store.set(SESSION_COOKIE, signSession(payload, ttl), {
    httpOnly: true,
    // Lax: sent on a top-level link from Slack or GroupMe, never on a
    // cross-site POST, which with server actions' own origin check is what
    // closes CSRF.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttl,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Throws if nobody is signed in. */
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

/**
 * Which brother the manager is currently looking through, if any.
 *
 * An admin session has no roster identity of its own - `sub` is the literal
 * string 'admin' - so "see what the house sees" has to name a real member.
 * Read-only by construction: every write action checks the acting member
 * against the row it changes, and 'admin' never matches one.
 */
export const VIEW_AS_COOKIE = 'zbt_view_as';

export async function getViewAs(): Promise<string | null> {
  const session = await getSession();
  if (session?.role !== 'admin') return null;
  const store = await cookies();
  return store.get(VIEW_AS_COOKIE)?.value ?? null;
}
