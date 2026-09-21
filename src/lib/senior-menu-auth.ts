import { createHmac, timingSafeEqual } from 'node:crypto';
import { getTvSettings } from './tv-service.ts';

export const MENU_AUTH_COOKIE = 'zbt_senior_menu_auth';
export const MENU_AUTH_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

// In-memory rate limiting map keyed by client IP
const ipAttempts = new Map<string, RateLimitRecord>();

export function getClientIp(headersMap: Headers | Record<string, string | string[] | undefined>): string {
  let headerValue: string | null = null;

  if (typeof (headersMap as Headers).get === 'function') {
    headerValue = (headersMap as Headers).get('x-forwarded-for') ??
      (headersMap as Headers).get('x-real-ip') ??
      (headersMap as Headers).get('cf-connecting-ip');
  } else {
    const raw = headersMap as Record<string, string | string[] | undefined>;
    const fwd = raw['x-forwarded-for'] || raw['x-real-ip'] || raw['cf-connecting-ip'];
    if (Array.isArray(fwd)) headerValue = fwd[0];
    else if (typeof fwd === 'string') headerValue = fwd;
  }

  if (headerValue) {
    // If comma-separated (e.g. from proxies), take the first client IP
    const first = headerValue.split(',')[0].trim();
    if (first) return first;
  }

  return '127.0.0.1';
}

export function checkRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterMs: number } {
  const now = Date.now();
  const record = ipAttempts.get(ip);

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, retryAfterMs: 0 };
  }

  // Check if currently locked out
  if (record.lockedUntil && record.lockedUntil > now) {
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterMs: record.lockedUntil - now,
    };
  }

  // If lockout expired or window expired, reset record
  if (record.lockedUntil && record.lockedUntil <= now) {
    ipAttempts.delete(ip);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, retryAfterMs: 0 };
  }

  if (now - record.firstAttemptAt > WINDOW_MS) {
    ipAttempts.delete(ip);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, retryAfterMs: 0 };
  }

  const remaining = Math.max(0, MAX_ATTEMPTS - record.attempts);
  return {
    allowed: remaining > 0,
    remainingAttempts: remaining,
    retryAfterMs: 0,
  };
}

export function recordFailedAttempt(ip: string): { locked: boolean; retryAfterMs: number; remainingAttempts: number } {
  const now = Date.now();
  let record = ipAttempts.get(ip);

  if (!record || now - record.firstAttemptAt > WINDOW_MS) {
    record = { attempts: 1, firstAttemptAt: now, lockedUntil: null };
  } else {
    record.attempts += 1;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    ipAttempts.set(ip, record);
    return { locked: true, retryAfterMs: LOCKOUT_MS, remainingAttempts: 0 };
  }

  ipAttempts.set(ip, record);
  return {
    locked: false,
    retryAfterMs: 0,
    remainingAttempts: Math.max(0, MAX_ATTEMPTS - record.attempts),
  };
}

export function clearRateLimit(ip: string): void {
  ipAttempts.delete(ip);
}

export async function getSeniorMenuPassword(): Promise<string> {
  const envPass = process.env.SENIOR_MENU_PASSWORD || process.env.MENU_PASSWORD;
  if (envPass && envPass.trim()) return envPass.trim();

  try {
    const tv = await getTvSettings();
    if (tv.seniorMenuPassword && typeof tv.seniorMenuPassword === 'string' && tv.seniorMenuPassword.trim()) {
      return tv.seniorMenuPassword.trim();
    }
  } catch {
    // Ignore DB fetch errors and use default
  }

  return 'zbt2026';
}

export async function verifySeniorMenuPassword(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const expected = await getSeniorMenuPassword();

  const a = Buffer.from(candidate.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function secret(): Buffer {
  const s = process.env.SESSION_SECRET || 'zbt-kitchen-secret-key-fallback-2026';
  return Buffer.from(s);
}

export function signMenuToken(ttlSeconds = MENU_AUTH_TTL_SECONDS): string {
  const payload = {
    role: 'senior_menu_viewer',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyMenuToken(token: string | undefined): boolean {
  if (!token) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;

  try {
    const expected = createHmac('sha256', secret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number') return false;
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;
    if (payload.role !== 'senior_menu_viewer') return false;
    return true;
  } catch {
    return false;
  }
}
