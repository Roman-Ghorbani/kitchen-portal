/**
 * Attempt limiting for every credential check.
 *
 * A four- or six-digit PIN is only as strong as the number of guesses it is
 * allowed. The policy is escalating lockout rather than a fixed window: a few
 * free mistakes, then a lock that doubles with each further failure up to a
 * day. A person who fat-fingers their PIN waits a minute; a script trying
 * every PIN gets about fifteen guesses on the first day and one a day after.
 *
 * Counters are stored in SQLite so a restart does not reset them. Each check
 * is recorded under two keys - the account being tried and the client IP - so
 * spreading guesses across many accounts from one address is caught too.
 */

import { eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { authThrottle } from '../db/schema.ts';

export interface ThrottlePolicy {
  /** Failures allowed before the first lock. */
  free: number;
  /** Length of the first lock; each further failure doubles it. */
  baseSeconds: number;
  maxSeconds: number;
  /** A quiet period after which the failure count starts again. */
  resetSeconds: number;
}

export const POLICIES = {
  /** One brother's PIN, across every client. */
  pin: { free: 5, baseSeconds: 60, maxSeconds: 86_400, resetSeconds: 86_400 },
  /** A setup code for one brother. */
  enrollment: { free: 5, baseSeconds: 600, maxSeconds: 86_400, resetSeconds: 86_400 },
  /** The manager account. Stricter: it is the one worth attacking. */
  admin: { free: 5, baseSeconds: 300, maxSeconds: 86_400, resetSeconds: 86_400 },
  /** The shared Senior Week menu password, per client. */
  menu: { free: 5, baseSeconds: 600, maxSeconds: 86_400, resetSeconds: 86_400 },
  /** Anything from one IP, across every account and credential type. */
  ip: { free: 25, baseSeconds: 300, maxSeconds: 86_400, resetSeconds: 3_600 },
  /** Tablet pairing codes, per client. */
  pairing: { free: 5, baseSeconds: 600, maxSeconds: 86_400, resetSeconds: 86_400 },
} satisfies Record<string, ThrottlePolicy>;

export interface ThrottleState {
  allowed: boolean;
  /** Seconds until the next attempt is accepted; 0 when allowed. */
  retryAfter: number;
}

const now = () => Date.now();

/** Pure: how long a lock should be after `failures` failures. */
export function lockSeconds(policy: ThrottlePolicy, failures: number): number {
  if (failures < policy.free) return 0;
  const exponent = failures - policy.free;
  return Math.min(policy.maxSeconds, policy.baseSeconds * 2 ** exponent);
}

export async function checkThrottle(keys: string[]): Promise<ThrottleState> {
  let retryAfter = 0;
  for (const key of keys) {
    const [row] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
    if (row?.lockedUntil && row.lockedUntil.getTime() > now()) {
      retryAfter = Math.max(retryAfter, Math.ceil((row.lockedUntil.getTime() - now()) / 1000));
    }
  }
  return { allowed: retryAfter === 0, retryAfter };
}

/**
 * Records a failure against each `[key, policy]` pair and returns the longest
 * resulting lock.
 */
export async function recordFailure(
  entries: Array<[string, ThrottlePolicy]>,
): Promise<ThrottleState & { remaining: number }> {
  let retryAfter = 0;
  let remaining = Number.POSITIVE_INFINITY;

  for (const [key, policy] of entries) {
    const [row] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
    const stale =
      row?.lastFailureAt && now() - row.lastFailureAt.getTime() > policy.resetSeconds * 1000;
    const failures = (row && !stale ? row.failures : 0) + 1;
    const lock = lockSeconds(policy, failures);
    const lockedUntil = lock > 0 ? new Date(now() + lock * 1000) : null;

    await db
      .insert(authThrottle)
      .values({ key, failures, lockedUntil, lastFailureAt: new Date() })
      .onConflictDoUpdate({
        target: authThrottle.key,
        set: { failures, lockedUntil, lastFailureAt: new Date() },
      });

    retryAfter = Math.max(retryAfter, lock);
    remaining = Math.min(remaining, Math.max(0, policy.free - failures));
  }

  return {
    allowed: retryAfter === 0,
    retryAfter,
    remaining: Number.isFinite(remaining) ? remaining : 0,
  };
}

/** A success clears the account key. The IP key is left to decay on its own. */
export async function clearThrottle(key: string): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, key));
}

export async function lockedKeys(prefix: string): Promise<Array<{ key: string; lockedUntil: Date }>> {
  const rows = await db.select().from(authThrottle);
  return rows
    .filter((r) => r.key.startsWith(prefix) && r.lockedUntil && r.lockedUntil.getTime() > now())
    .map((r) => ({ key: r.key, lockedUntil: r.lockedUntil! }));
}

/** "4 minutes", "about 2 hours" - for the message a locked-out person sees. */
export function describeWait(seconds: number): string {
  if (seconds < 90) return 'a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}
