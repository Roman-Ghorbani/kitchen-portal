'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '../../db/index.ts';
import { members, events } from '../../db/schema.ts';
import {
  hashPin,
  verifyPin,
  isValidPinFormat,
  isWeakPin,
  verifyAdminPassword,
} from '../../lib/auth.ts';
import { setSession, clearSession } from '../../lib/session.ts';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Signs a brother in, setting his PIN on first use.
 *
 * Deliberately does not distinguish "wrong PIN" from "no PIN set" in a way
 * that would let someone probe who has signed up yet - the client already
 * knows that from the roster list, so there is nothing to leak, but the error
 * text stays uniform anyway.
 */
export async function signInBrother(
  memberId: string,
  pin: string,
): Promise<ActionResult> {
  if (!isValidPinFormat(pin)) {
    return { ok: false, error: 'Your PIN must be exactly 4 digits.' };
  }

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member || !member.active) {
    return { ok: false, error: 'That name is not on the roster.' };
  }

  if (!member.pinHash) {
    // First sign-in: this PIN becomes theirs.
    await db
      .update(members)
      .set({ pinHash: hashPin(pin) })
      .where(eq(members.id, memberId));

    await db.insert(events).values({
      action: 'member.pin_set',
      entityType: 'member',
      entityId: member.id,
      actorMemberId: member.id,
      actorName: member.name,
      summary: `${member.name} set a PIN and signed in for the first time`,
    });
  } else if (!verifyPin(pin, member.pinHash)) {
    return { ok: false, error: 'That PIN does not match.' };
  }

  await setSession({ sub: member.id, role: 'brother', name: member.name });
  redirect('/schedule');
}

export async function signInAdmin(password: string): Promise<ActionResult> {
  if (!verifyAdminPassword(password)) {
    return { ok: false, error: 'Incorrect password.' };
  }

  await setSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager' });
  redirect('/admin');
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/signin');
}

/**
 * Clears a brother's PIN so he can set a new one. Admin only - this is the
 * "I forgot my PIN" path, and it is logged because it is the one action that
 * could be used to take over somebody else's identity.
 */
export async function resetMemberPin(memberId: string): Promise<ActionResult> {
  const { requireAdmin } = await import('../../lib/session.ts');
  const admin = await requireAdmin();

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) return { ok: false, error: 'No such member.' };

  await db.update(members).set({ pinHash: null }).where(eq(members.id, memberId));

  await db.insert(events).values({
    action: 'member.pin_reset',
    entityType: 'member',
    entityId: member.id,
    actorName: admin.name,
    summary: `${admin.name} reset ${member.name}'s PIN`,
  });

  return { ok: true };
}
