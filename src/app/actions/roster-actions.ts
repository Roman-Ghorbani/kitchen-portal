'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '../../db/index.ts';
import { members, events } from '../../db/schema.ts';
import { requireAdmin } from '../../lib/session.ts';
import type { ClassYear, ExemptReason } from '../../lib/types.ts';

export interface RosterResult {
  ok: boolean;
  message: string;
}

function refresh() {
  revalidatePath('/admin/roster');
  revalidatePath('/admin');
}

/**
 * Changes someone's duty year, which changes the meal they serve.
 *
 * Needed because pledge class is only a default: brothers who rushed a year
 * late are a year older than the rest of their class, and the import cannot
 * know that.
 */
export async function setClassYear(
  memberId: string,
  classYear: ClassYear,
): Promise<RosterResult> {
  const admin = await requireAdmin();

  const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };
  if (m.classYear === classYear) return { ok: true, message: 'No change.' };

  await db.update(members).set({ classYear }).where(eq(members.id, memberId));

  await db.insert(events).values({
    action: 'roster.class_year_changed',
    entityType: 'member',
    entityId: memberId,
    actorName: admin.name,
    actorRole: 'manager',
    summary:
      `${admin.name} changed ${m.name} from ${m.classYear} to ${classYear} ` +
      `(${classYear === 'junior' ? 'lunch' : 'dinner'} duty)`,
    payload: { from: m.classYear, to: classYear },
  });

  refresh();
  return {
    ok: true,
    message: `${m.name} is now a ${classYear} — ${
      classYear === 'junior' ? 'lunch' : 'dinner'
    } duty. Already-posted weeks are unchanged.`,
  };
}

export async function setExempt(
  memberId: string,
  exempt: boolean,
  reason: ExemptReason | null,
  notes: string,
): Promise<RosterResult> {
  const admin = await requireAdmin();

  const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };

  await db
    .update(members)
    .set({
      exempt,
      exemptReason: exempt ? (reason ?? 'other') : null,
      exemptNotes: exempt ? notes.trim() || null : null,
    })
    .where(eq(members.id, memberId));

  await db.insert(events).values({
    action: exempt ? 'roster.exempted' : 'roster.unexempted',
    entityType: 'member',
    entityId: memberId,
    actorName: admin.name,
    actorRole: 'manager',
    summary: exempt
      ? `${admin.name} exempted ${m.name} (${reason ?? 'other'})` +
        (notes.trim() ? ` — "${notes.trim()}"` : '')
      : `${admin.name} removed ${m.name}'s exemption`,
    payload: { exempt, reason, notes: notes.trim() || null },
  });

  refresh();
  return {
    ok: true,
    message: exempt
      ? `${m.name} is exempt and will not be auto-scheduled.`
      : `${m.name} is back in the rotation.`,
  };
}

/**
 * Manually nudges someone's points. Logged with the delta because a hand
 * adjustment is exactly the kind of thing that gets questioned later.
 */
export async function adjustPoints(
  memberId: string,
  delta: number,
): Promise<RosterResult> {
  const admin = await requireAdmin();

  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 20) {
    return { ok: false, message: 'Adjustment must be a whole number, at most 20.' };
  }

  const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };

  await db
    .update(members)
    .set({ points: sql`MAX(0, ${members.points} + ${delta})` })
    .where(eq(members.id, memberId));

  const [after] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);

  await db.insert(events).values({
    action: 'roster.points_adjusted',
    entityType: 'member',
    entityId: memberId,
    actorName: admin.name,
    actorRole: 'manager',
    summary: `${admin.name} adjusted ${m.name}'s points by ${
      delta > 0 ? '+' : ''
    }${delta} (${m.points} → ${after.points})`,
    payload: { delta, before: m.points, after: after.points },
  });

  refresh();
  return { ok: true, message: `${m.name}: ${m.points} → ${after.points}.` };
}

export async function setMakeupDebt(
  memberId: string,
  debt: number,
): Promise<RosterResult> {
  const admin = await requireAdmin();

  if (!Number.isInteger(debt) || debt < 0 || debt > 10) {
    return { ok: false, message: 'Make-up debt must be between 0 and 10.' };
  }

  const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };

  await db.update(members).set({ makeupDebt: debt }).where(eq(members.id, memberId));

  await db.insert(events).values({
    action: 'roster.debt_set',
    entityType: 'member',
    entityId: memberId,
    actorName: admin.name,
    actorRole: 'manager',
    summary: `${admin.name} set ${m.name}'s make-up debt to ${debt} (was ${m.makeupDebt})`,
    payload: { before: m.makeupDebt, after: debt },
  });

  refresh();
  return { ok: true, message: `${m.name} owes ${debt} make-up shift(s).` };
}

/** Takes someone off the roster without deleting their history. */
export async function setActive(
  memberId: string,
  active: boolean,
): Promise<RosterResult> {
  const admin = await requireAdmin();

  const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!m) return { ok: false, message: 'No such member.' };

  await db.update(members).set({ active }).where(eq(members.id, memberId));

  await db.insert(events).values({
    action: active ? 'roster.reactivated' : 'roster.deactivated',
    entityType: 'member',
    entityId: memberId,
    actorName: admin.name,
    actorRole: 'manager',
    summary: `${admin.name} ${active ? 'restored' : 'removed'} ${m.name} ${
      active ? 'to' : 'from'
    } the roster`,
  });

  refresh();
  return {
    ok: true,
    message: active ? `${m.name} restored.` : `${m.name} removed from the roster.`,
  };
}
