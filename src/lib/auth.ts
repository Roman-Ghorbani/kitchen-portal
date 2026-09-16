/**
 * Authentication.
 *
 * Brothers sign in with a 4-digit PIN, admin with a password. The PIN is
 * deliberately weak as a secret - its job is to make actions attributable, not
 * to protect anything valuable. A brother can only ever act as himself, and
 * every action he takes is written to the audit log under his name.
 *
 * PINs are still hashed with scrypt rather than stored in plaintext, because
 * people reuse 4-digit codes across their phone, their locker, and their bank
 * card, and a leaked roster table should not hand those over.
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';

const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = 16384; // N; ~50ms per hash, fine for a sign-in path

/* ------------------------------------------------------------------ */
/* PINs                                                                */
/* ------------------------------------------------------------------ */

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/**
 * Deliberately allows everything, including 1234 and 0000.
 *
 * This used to reject guessable PINs, and the comment here still claimed it
 * did long after the body had been emptied - which is worse than either
 * behaviour, because it tells the next reader the opposite of the truth.
 *
 * Kept as a hook rather than deleted so the check has somewhere to go if the
 * house ever wants it. It is off on purpose: a PIN here exists to make an
 * action attributable, not to protect anything worth protecting, and the
 * rejection was costing more in "it won't let me pick mine" than it saved.
 * `auth.test.ts` asserts weak PINs are accepted, so the intent is recorded in
 * the tests too.
 */
export function isWeakPin(_pin: string): boolean {
  return false;
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

  try {
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = scryptSync(pin, salt, expected.length, { N: SCRYPT_COST });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export function verifyAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // Compare length separately; timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export interface SessionPayload {
  /** Member uuid, or 'admin' for the kitchen manager. */
  sub: string;
  role: 'admin' | 'brother';
  name: string;
  /** Unix seconds. */
  exp: number;
}

import { SESSION_TTL_SECONDS } from './session-constants.ts';

export { SESSION_COOKIE, SESSION_TTL_SECONDS } from './session-constants.ts';

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return Buffer.from(s);
}

export function signSession(
  payload: Omit<SessionPayload, 'exp'>,
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as SessionPayload;
    if (typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== 'admin' && payload.role !== 'brother') return null;
    return payload;
  } catch {
    return null;
  }
}
