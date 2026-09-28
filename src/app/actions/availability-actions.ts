'use server';

import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '../../db/index.ts';
import { standingConflicts, members, events } from '../../db/schema.ts';
import { getSession } from '../../lib/session.ts';
import { getActiveSemester } from '../../lib/week-service.ts';

export interface AvailabilityResult {
  ok: boolean;
  message: string;
}

const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/**
 * Sets a standing weekly conflict, or clears it.
 *
 * Because class year fixes the meal - juniors only ever do lunch, sophomores
 * only dinner - one day index per person is enough. Blocking Tuesday blocks
 * Tuesday lunch for a junior, and nothing else needs saying.
 *
 * This is the primary defence against last-minute drama: someone who sets a
 * recurring class conflict once is simply never scheduled then, so there is
 * nothing to flag and nothing to argue about later.
 */
export async function setStandingConflict(
  dayIndex: number,
  blocked: boolean,
  note: string,
): Promise<AvailabilityResult> {
  const session = await getSession();
  if (!session || session.role !== 'brother') {
    return { ok: false, message: 'Sign in first.' };
  }

  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return { ok: false, message: 'Not a valid day.' };
  }

  const semester = await getActiveSemester();

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, session.sub))
    .limit(1);
  if (!member) return { ok: false, message: 'You are not on the roster.' };

  const where = and(
    eq(standingConflicts.memberId, session.sub),
    eq(standingConflicts.semesterId, semester.id),
    eq(standingConflicts.dayIndex, dayIndex),
  );

  if (blocked) {
    const existing = await db.select().from(standingConflicts).where(where);
    if (existing.length > 0) {
      await db
        .update(standingConflicts)
        .set({ note: note.trim() || null })
        .where(where);
    } else {
      await db.insert(standingConflicts).values({
        memberId: session.sub,
        semesterId: semester.id,
        dayIndex,
        note: note.trim() || null,
        scope: 'semester',
      });
    }
  } else {
    await db.delete(standingConflicts).where(where);
  }

  await db.insert(events).values({
    action: blocked ? 'availability.blocked' : 'availability.cleared',
    entityType: 'member',
    entityId: session.sub,
    actorMemberId: session.sub,
    actorName: session.name,
    actorRole: 'brother',
    summary: blocked
      ? `${session.name} marked ${DAY_NAMES[dayIndex]} unavailable` +
        (note.trim() ? ` — "${note.trim()}"` : '')
      : `${session.name} cleared their ${DAY_NAMES[dayIndex]} conflict`,
    payload: { dayIndex, note: note.trim() || null },
  });

  revalidatePath('/availability');

  return {
    ok: true,
    message: blocked
      ? `${DAY_NAMES[dayIndex]} saved — you will not be scheduled then.`
      : `${DAY_NAMES[dayIndex]} cleared.`,
  };
}

/**
 * `forMemberId` is only ever passed by a manager looking through somebody's
 * eyes; it is checked against the admin role here rather than trusted, so a
 * brother cannot read another brother's conflicts by passing an id.
 */
export async function getMyConflicts(
  forMemberId?: string,
): Promise<{ dayIndex: number; note: string | null }[]> {
  const session = await getSession();
  if (!session) return [];

  const memberId =
    forMemberId && session.role === 'admin' ? forMemberId : session.sub;
  if (session.role !== 'brother' && memberId === session.sub) return [];

  const semester = await getActiveSemester();
  const rows = await db
    .select()
    .from(standingConflicts)
    .where(
      and(
        eq(standingConflicts.memberId, memberId),
        eq(standingConflicts.semesterId, semester.id),
      ),
    );

  return rows.map((r) => ({ dayIndex: r.dayIndex, note: r.note }));
}

/**
 * Admin action to set or clear a standing conflict for any member.
 */
export async function adminSetMemberAvailability(
  targetMemberId: string,
  dayIndex: number,
  blocked: boolean,
  note: string = '',
): Promise<AvailabilityResult> {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return { ok: false, message: 'Admin access required.' };
  }

  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return { ok: false, message: 'Not a valid day.' };
  }

  const semester = await getActiveSemester();

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, targetMemberId))
    .limit(1);
  if (!member) return { ok: false, message: 'Member not found.' };

  const where = and(
    eq(standingConflicts.memberId, targetMemberId),
    eq(standingConflicts.semesterId, semester.id),
    eq(standingConflicts.dayIndex, dayIndex),
  );

  if (blocked) {
    const existing = await db.select().from(standingConflicts).where(where);
    if (existing.length > 0) {
      await db
        .update(standingConflicts)
        .set({ note: note.trim() || null })
        .where(where);
    } else {
      await db.insert(standingConflicts).values({
        memberId: targetMemberId,
        semesterId: semester.id,
        dayIndex,
        note: note.trim() || null,
        scope: 'semester',
      });
    }
  } else {
    await db.delete(standingConflicts).where(where);
  }

  await db.insert(events).values({
    action: blocked ? 'availability.blocked_by_admin' : 'availability.cleared_by_admin',
    entityType: 'member',
    entityId: targetMemberId,
    actorName: session.name,
    actorRole: 'manager',
    summary: blocked
      ? `${session.name} marked ${member.name} unavailable on ${DAY_NAMES[dayIndex]}` +
        (note.trim() ? ` — "${note.trim()}"` : '')
      : `${session.name} cleared ${member.name}'s ${DAY_NAMES[dayIndex]} conflict`,
    payload: { targetMemberId, dayIndex, note: note.trim() || null },
  });

  revalidatePath(`/admin/member/${targetMemberId}`);
  revalidatePath('/admin/roster');
  revalidatePath('/admin/week');

  return {
    ok: true,
    message: blocked
      ? `${member.name} marked unavailable on ${DAY_NAMES[dayIndex]}.`
      : `${member.name}'s ${DAY_NAMES[dayIndex]} conflict cleared.`,
  };
}
