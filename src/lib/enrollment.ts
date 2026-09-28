/**
 * Setup codes: how a brother claims his account.
 *
 * Before these existed, the first person to pick a name with no PIN set got to
 * choose that PIN - and since the sign-in page lists everybody, "anybody who
 * got there first" was the whole security model. Now the manager issues a
 * one-time code per brother (singly from his record, or in bulk for everyone
 * who has not signed in yet) and hands it over in person or by DM. The code is
 * shown once, stored only as a keyed hash, expires after a week, and dies the
 * moment it is used or a newer one is issued.
 */

import { and, eq, gt, isNull, inArray } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { enrollmentCodes, members } from '../db/schema.ts';
import { keyedHash, normaliseCode, randomCode, safeEqual } from './auth.ts';

export const ENROLLMENT_TTL_DAYS = 7;

const hashOf = (code: string) => keyedHash('enrollment', normaliseCode(code));

/** Issues a fresh code for one member, retiring any unused one he had. */
export async function issueEnrollmentCode(
  memberId: string,
  writer: Pick<typeof db, 'insert' | 'update'> = db,
): Promise<{ code: string; expiresAt: Date }> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_DAYS * 86_400_000);

  await writer
    .update(enrollmentCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(enrollmentCodes.memberId, memberId), isNull(enrollmentCodes.usedAt)));

  await writer.insert(enrollmentCodes).values({ memberId, codeHash: hashOf(code), expiresAt });
  return { code, expiresAt };
}

/**
 * Checks a code for a member and burns it. Returns false for wrong, expired,
 * already-used or superseded codes alike - the caller does not need to know
 * which, and neither does whoever is guessing.
 */
export async function redeemEnrollmentCode(memberId: string, code: string): Promise<boolean> {
  const candidates = await db
    .select()
    .from(enrollmentCodes)
    .where(
      and(
        eq(enrollmentCodes.memberId, memberId),
        isNull(enrollmentCodes.usedAt),
        gt(enrollmentCodes.expiresAt, new Date()),
      ),
    );

  const wanted = hashOf(code);
  const match = candidates.find((c) => safeEqual(c.codeHash, wanted));
  if (!match) return false;

  await db.update(enrollmentCodes).set({ usedAt: new Date() }).where(eq(enrollmentCodes.id, match.id));
  return true;
}

/** Members with an unexpired, unused code outstanding - for the roster view. */
export async function pendingEnrollment(memberIds: string[]): Promise<Map<string, Date>> {
  if (memberIds.length === 0) return new Map();
  const rows = await db
    .select({ memberId: enrollmentCodes.memberId, expiresAt: enrollmentCodes.expiresAt })
    .from(enrollmentCodes)
    .where(
      and(
        inArray(enrollmentCodes.memberId, memberIds),
        isNull(enrollmentCodes.usedAt),
        gt(enrollmentCodes.expiresAt, new Date()),
      ),
    );
  return new Map(rows.map((r) => [r.memberId, r.expiresAt]));
}

/** Active members who have never set a PIN. */
export async function membersWithoutPin() {
  return db
    .select({ id: members.id, name: members.name, rotation: members.rotation })
    .from(members)
    .where(and(eq(members.active, true), isNull(members.pinHash)))
    .orderBy(members.name);
}
