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

export async function getMyConflicts(): Promise<
  { dayIndex: number; note: string | null }[]
> {
  const session = await getSession();
  if (!session || session.role !== 'brother') return [];

  const semester = await getActiveSemester();
  const rows = await db
    .select()
    .from(standingConflicts)
    .where(
      and(
        eq(standingConflicts.memberId, session.sub),
        eq(standingConflicts.semesterId, semester.id),
      ),
    );

  return rows.map((r) => ({ dayIndex: r.dayIndex, note: r.note }));
}
