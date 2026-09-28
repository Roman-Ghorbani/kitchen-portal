/**
 * Credentials and session tokens - pure functions, no database, no framework.
 *
 * Everything here is deterministic given its inputs and the environment, which
 * is what lets `auth.test.ts` cover it exhaustively. The stateful half - who is
 * locked out, which session version is current - lives in `session.ts`,
 * `throttle.ts` and `enrollment.ts`.
 *
 * Threat model, briefly (SECURITY.md has the long version): the app sits on a
 * public hostname, the roster of names is visible to anyone who opens the
 * sign-in page, and the realistic attacker is a house member or a friend of
 * one trying to act as somebody else. So:
 *
 *  - Claiming an account needs a one-time setup code from the manager, not
 *    just knowledge of a name.
 *  - PINs are short, so they are rate limited per account and per IP, stored
 *    as scrypt hashes, and new ones must be six digits and not a sequence.
 *  - The manager's password is stored as a scrypt hash and paired with a TOTP
 *    code, and his session is short.
 *  - Sessions are HMAC-signed and carry a version number, so changing a
 *    credential ends every session issued under the old one.
 */

import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

import {
  ADMIN_SESSION_TTL_SECONDS,
  BROTHER_SESSION_TTL_SECONDS,
} from './session-constants.ts';

export {
  SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  BROTHER_SESSION_TTL_SECONDS,
} from './session-constants.ts';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const SCRYPT_KEYLEN = 32;
/** N = 2^14: ~50 ms on a Raspberry Pi 4, which is fine for a sign-in path. */
const SCRYPT_COST = 16384;

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  // Hashing first makes both sides the same length, so the comparison itself
  // leaks nothing - not even the length of the secret.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** A scrypt hash in the form `scrypt$<salt>$<hash>`, both base64url. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const cleanStored = stored.trim().replace(/^["']|["']$/g, '');
  const [scheme, saltB64, hashB64] = cleanStored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) {
    console.log('[verifySecret parse failed]', { cleanStored: cleanStored.slice(0, 15), scheme });
    return false;
  }

  try {
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    if (expected.length !== SCRYPT_KEYLEN) {
      console.log('[verifySecret keylen mismatch]', { expLen: expected.length, SCRYPT_KEYLEN });
      return false;
    }
    const actual = scryptSync(secret, salt, expected.length, { N: SCRYPT_COST });
    const match = timingSafeEqual(actual, expected);
    console.log('[verifySecret result]', { match, secretLen: secret.length });
    return match;
  } catch (err) {
    console.log('[verifySecret error]', err);
    return false;
  }
}

/**
 * The server's signing key.
 *
 * Refuses to run with a short or missing secret rather than falling back to a
 * default: a default secret in a public repository is a published key.
 */
export function sessionSecret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  }
  return Buffer.from(s);
}

/** Keyed hash for high-entropy, short-lived values (setup and pairing codes). */
export function keyedHash(purpose: string, value: string): string {
  return createHmac('sha256', sessionSecret())
    .update(`${purpose}:${value}`)
    .digest('base64url');
}

/**
 * A human-typeable random code, e.g. `K7QM-3XWD`.
 *
 * Crockford's base-32 alphabet - no I, L, O or U - so nobody reads a 1 as an
 * l over the phone. Eight characters is 40 bits, which, with the attempt
 * limits in front of it and a short expiry, is far out of guessing range.
 */
export function randomCode(length = 8): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % 32];
  return `${out.slice(0, length / 2)}-${out.slice(length / 2)}`;
}

/** Normalises what somebody typed into the canonical code form. */
export function normaliseCode(input: string): string {
  const clean = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/* ------------------------------------------------------------------ */
/* PINs                                                                */
/* ------------------------------------------------------------------ */

/** Length required when a PIN is set or changed. */
export const NEW_PIN_LENGTH = 6;

/**
 * What the sign-in form accepts. Four digits is still valid so the PINs set
 * before the six-digit rule keep working; they can be upgraded from Home.
 */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$|^\d{6}$/.test(pin);
}

export function isValidNewPin(pin: string): boolean {
  return new RegExp(`^\\d{${NEW_PIN_LENGTH}}$`).test(pin);
}

/**
 * PINs an attacker would try first: a single repeated digit, a straight run
 * up or down, a repeated pair or triple, or one of the handful that top every
 * leaked-PIN list.
 */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 000000

  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return true; // 123456, 987654

  if (/^(\d\d)\1+$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return true; // 121212, 123123

  return COMMON_PINS.has(pin);
}

const COMMON_PINS = new Set([
  '112233', '123321', '654321', '666666', '696969', '131313', '159753',
  '147258', '258369', '102030', '101010', '000123', '520520', '789456',
]);

export const hashPin = hashSecret;
export const verifyPin = verifySecret;

/* ------------------------------------------------------------------ */
/* Kitchen manager                                                     */
/* ------------------------------------------------------------------ */

/**
 * Checks the manager password.
 *
 * `ADMIN_PASSWORD_HASH` (scrypt, from `npm run admin:credentials`) is the
 * supported configuration. A plaintext `ADMIN_PASSWORD` is still read so an
 * existing deployment keeps working through the upgrade, and the settings
 * page warns until it is replaced.
 */
export function verifyAdminPassword(candidate: string): boolean {
  if (!candidate) return false;
  const clean = candidate.trim();
  const hashed = process.env.ADMIN_PASSWORD_HASH?.trim().replace(/^["']|["']$/g, '');
  if (hashed) {
    return verifySecret(clean, hashed);
  }

  const plain = process.env.ADMIN_PASSWORD?.trim().replace(/^["']|["']$/g, '');
  if (plain) {
    return safeEqual(clean, plain);
  }

  return false;
}

export function adminPasswordIsHashed(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD_HASH);
}

export function adminTotpEnabled(): boolean {
  return Boolean(process.env.ADMIN_TOTP_SECRET);
}

/**
 * A short keyed fingerprint of the manager's configured credentials. Carried
 * in his session and re-checked on every request, so rotating the password or
 * the TOTP secret in the environment ends every session issued before it.
 */
export function adminCredentialFingerprint(): string {
  const material = `${process.env.ADMIN_PASSWORD_HASH ?? process.env.ADMIN_PASSWORD ?? ''}|${process.env.ADMIN_TOTP_SECRET ?? ''}`;
  return keyedHash('admin-credentials', material).slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* TOTP (RFC 6238)                                                     */
/* ------------------------------------------------------------------ */

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** The TOTP code for one 30-second step (HOTP over the step counter). */
export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(binary).padStart(TOTP_DIGITS, '0');
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Returns the step the code matched, or null.
 *
 * Accepts one step either side for clock drift. The caller records the step
 * and refuses any code at or before it, so a code read over the manager's
 * shoulder cannot be replayed inside its 90-second window.
 */
export function matchTotp(
  secretBase32: string,
  code: string,
  nowMs = Date.now(),
): number | null {
  const cleanCode = (code || '').replace(/\s/g, '').trim();
  if (!/^\d{6}$/.test(cleanCode)) return null;
  const cleanSecret = (secretBase32 || '').trim().replace(/^["']|["']$/g, '');
  const now = totpStep(nowMs);
  for (const step of [now, now - 1, now + 1, now - 2, now + 2]) {
    const exp = totpAt(cleanSecret, step);
    if (safeEqual(exp, cleanCode)) return step;
  }
  console.log(`[matchTotp mismatch] received=${cleanCode}, expectedNow=${totpAt(cleanSecret, now)}, nowStep=${now}`);
  return null;
}

/* ------------------------------------------------------------------ */
/* Session tokens                                                      */
/* ------------------------------------------------------------------ */

export interface SessionPayload {
  /** Member uuid, or 'admin' for the kitchen manager. */
  sub: string;
  role: 'admin' | 'brother';
  name: string;
  /**
   * Credential version the session was issued under. Compared against the
   * member row (or the manager's setting) on every request; see session.ts.
   * Absent on sessions issued before versioning, which count as version 0.
   */
  ver?: number;
  /** Manager only: fingerprint of the credentials he signed in with. */
  cf?: string;
  /** Issued at, unix seconds. */
  iat?: number;
  /** Expires at, unix seconds. */
  exp: number;
}

export function signSession(
  payload: Omit<SessionPayload, 'exp' | 'iat'>,
  ttlSeconds = payload.role === 'admin'
    ? ADMIN_SESSION_TTL_SECONDS
    : BROTHER_SESSION_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Checks the signature and expiry. Says nothing about whether the session has
 * since been revoked - that needs the database, so it is session.ts's job.
 */
export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== 'admin' && payload.role !== 'brother') return null;
    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
