'use server';

/**
 * Sign-in, enrollment and credential management.
 *
 * Every path here follows the same order: check the throttle, check the
 * credential, record the outcome (throttle and audit log), and only then touch
 * the session. Failures return one uniform message per form so a guesser learns
 * nothing about which part was wrong.
 */

import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '../../db/index.ts';
import { members } from '../../db/schema.ts';
import {
  hashPin,
  verifyPin,
  isValidPinFormat,
  isValidNewPin,
  isWeakPin,
  verifyAdminPassword,
  adminTotpEnabled,
  matchTotp,
  NEW_PIN_LENGTH,
  adminCredentialFingerprint,
} from '../../lib/auth.ts';
import {
  setSession,
  clearSession,
  requireAdmin,
  requireSession,
  ADMIN_NAME,
} from '../../lib/session.ts';
import {
  adminSessionVersion,
  bumpAdminSessionVersion,
  getSetting,
  setSetting,
  SETTING,
} from '../../lib/app-settings.ts';
import {
  checkThrottle,
  recordFailure,
  clearThrottle,
  describeWait,
  POLICIES,
} from '../../lib/throttle.ts';
import { issueEnrollmentCode, redeemEnrollmentCode, ENROLLMENT_TTL_DAYS } from '../../lib/enrollment.ts';
import { logEvent } from '../../lib/audit.ts';
import { requestContext, type RequestContext } from '../../lib/request-context.ts';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const pinKey = (id: string) => `pin:${id}`;
const enrollKey = (id: string) => `enroll:${id}`;
const ipKey = (ip: string) => `ip:${ip}`;

function lockedOut(retryAfter: number): ActionResult {
  return { ok: false, error: `Too many attempts. Try again in ${describeWait(retryAfter)}.` };
}

async function activeMember(memberId: string) {
  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  return member?.active ? member : null;
}

/* ------------------------------------------------------------------ */
/* Brothers                                                            */
/* ------------------------------------------------------------------ */

export async function signInBrother(memberId: string, pin: string): Promise<ActionResult> {
  const ctx = await requestContext();
  const gate = await checkThrottle([pinKey(memberId), ipKey(ctx.ip)]);
  if (!gate.allowed) return lockedOut(gate.retryAfter);

  const member = await activeMember(memberId);
  if (!member) return { ok: false, error: 'That name is not on the roster.' };
  if (!member.pinHash) {
    return { ok: false, error: 'You have not set a PIN yet. Use your setup code.' };
  }

  if (!isValidPinFormat(pin) || !verifyPin(pin, member.pinHash)) {
    const after = await recordFailure([
      [pinKey(memberId), POLICIES.pin],
      [ipKey(ctx.ip), POLICIES.ip],
    ]);
    await logAuth('auth.signin_failed', member, ctx, `Failed PIN attempt for ${member.name}`, {
      lockedFor: after.retryAfter || undefined,
    });
    if (!after.allowed) return lockedOut(after.retryAfter);
    return { ok: false, error: 'That PIN does not match.' };
  }

  await clearThrottle(pinKey(memberId));
  await logAuth('auth.signin', member, ctx, `${member.name} signed in`);
  await setSession({ sub: member.id, role: 'brother', name: member.name, ver: member.sessionVersion });
  redirect('/');
}

/**
 * First sign-in: the setup code from the manager, and the PIN he chooses.
 * Both are checked before anything is written, and the code is burned even
 * if the PIN is then refused, so a code cannot be probed for validity.
 */
export async function enrollBrother(
  memberId: string,
  code: string,
  newPin: string,
): Promise<ActionResult> {
  const ctx = await requestContext();

  if (!isValidNewPin(newPin)) {
    return { ok: false, error: `Your PIN must be exactly ${NEW_PIN_LENGTH} digits.` };
  }
  if (isWeakPin(newPin)) {
    return { ok: false, error: 'That PIN is too easy to guess. Avoid runs and repeats.' };
  }

  const gate = await checkThrottle([enrollKey(memberId), ipKey(ctx.ip)]);
  if (!gate.allowed) return lockedOut(gate.retryAfter);

  const member = await activeMember(memberId);
  if (!member) return { ok: false, error: 'That name is not on the roster.' };

  if (member.pinHash || !(await redeemEnrollmentCode(memberId, code))) {
    const after = await recordFailure([
      [enrollKey(memberId), POLICIES.enrollment],
      [ipKey(ctx.ip), POLICIES.ip],
    ]);
    await logAuth('auth.enroll_failed', member, ctx, `Failed setup code attempt for ${member.name}`);
    if (!after.allowed) return lockedOut(after.retryAfter);
    return { ok: false, error: 'That setup code is not valid. Codes expire after a week.' };
  }

  const version = member.sessionVersion + 1;
  await db
    .update(members)
    .set({ pinHash: hashPin(newPin), sessionVersion: version })
    .where(eq(members.id, memberId));
  await clearThrottle(enrollKey(memberId));
  await clearThrottle(pinKey(memberId));

  await logAuth('member.pin_set', member, ctx, `${member.name} redeemed a setup code and set a PIN`);
  await setSession({ sub: member.id, role: 'brother', name: member.name, ver: version });
  redirect('/');
}

/** Changing a PIN signs out every other device holding the old session. */
export async function changePin(currentPin: string, newPin: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'brother') return { ok: false, error: 'Brothers only.' };
  const ctx = await requestContext();

  if (!isValidNewPin(newPin)) {
    return { ok: false, error: `Your new PIN must be exactly ${NEW_PIN_LENGTH} digits.` };
  }
  if (isWeakPin(newPin)) {
    return { ok: false, error: 'That PIN is too easy to guess. Avoid runs and repeats.' };
  }

  const gate = await checkThrottle([pinKey(session.sub), ipKey(ctx.ip)]);
  if (!gate.allowed) return lockedOut(gate.retryAfter);

  const member = await activeMember(session.sub);
  if (!member) return { ok: false, error: 'Your roster entry is inactive.' };

  if (!verifyPin(currentPin, member.pinHash)) {
    const after = await recordFailure([
      [pinKey(member.id), POLICIES.pin],
      [ipKey(ctx.ip), POLICIES.ip],
    ]);
    await logAuth('auth.pin_change_failed', member, ctx, `Failed PIN change for ${member.name}`);
    if (!after.allowed) return lockedOut(after.retryAfter);
    return { ok: false, error: 'Your current PIN does not match.' };
  }

  const version = member.sessionVersion + 1;
  await db
    .update(members)
    .set({ pinHash: hashPin(newPin), sessionVersion: version })
    .where(eq(members.id, member.id));
  await logAuth('member.pin_changed', member, ctx, `${member.name} changed his PIN`);
  await setSession({ sub: member.id, role: 'brother', name: member.name, ver: version });
  return { ok: true };
}

export async function signOutEverywhere(): Promise<void> {
  const session = await requireSession();
  const ctx = await requestContext();

  if (session.role === 'admin') {
    await bumpAdminSessionVersion();
    await logEvent({
      action: 'auth.signout_everywhere',
      entityType: 'admin',
      actorRole: 'manager',
      actorName: ADMIN_NAME,
      summary: `${ADMIN_NAME} signed out every manager session`,
      payload: { ip: ctx.ip },
    });
  } else {
    await db
      .update(members)
      .set({ sessionVersion: sql`${members.sessionVersion} + 1` })
      .where(eq(members.id, session.sub));
    const member = await activeMember(session.sub);
    if (member) await logAuth('auth.signout_everywhere', member, ctx, `${member.name} signed out on every device`);
  }

  await clearSession();
  redirect('/signin');
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/signin');
}

/* ------------------------------------------------------------------ */
/* Kitchen manager                                                     */
/* ------------------------------------------------------------------ */

export async function signInAdmin(password: string, totp: string): Promise<ActionResult> {
  const ctx = await requestContext();
  const gate = await checkThrottle(['admin', ipKey(ctx.ip)]);
  if (!gate.allowed) return lockedOut(gate.retryAfter);

  let step: number | null = null;
  let passOk = verifyAdminPassword(password);
  let totpOk = true;

  if (passOk && adminTotpEnabled()) {
    step = matchTotp(process.env.ADMIN_TOTP_SECRET!, totp.replace(/\s/g, ''));
    const lastStep = await getSetting<number>(SETTING.adminTotpLastStep, 0);
    totpOk = step !== null && step > lastStep;
  }
  const ok = passOk && totpOk;

  if (!ok) {
    console.log(`[signInAdmin failed] passOk=${passOk}, totpOk=${totpOk}, totpLen=${totp.length}, step=${step}`);
    const after = await recordFailure([
      ['admin', POLICIES.admin],
      [ipKey(ctx.ip), POLICIES.ip],
    ]);
    await logEvent({
      action: 'auth.admin_signin_failed',
      entityType: 'admin',
      actorRole: 'anonymous',
      summary: `Failed kitchen manager sign-in from ${ctx.ip}`,
      payload: { ip: ctx.ip, userAgent: ctx.userAgent, lockedFor: after.retryAfter || undefined },
    });
    if (!after.allowed) return lockedOut(after.retryAfter);
    return {
      ok: false,
      error: adminTotpEnabled() ? 'Incorrect password or code.' : 'Incorrect password.',
    };
  }

  if (step !== null) await setSetting(SETTING.adminTotpLastStep, step);
  await clearThrottle('admin');
  await logEvent({
    action: 'auth.admin_signin',
    entityType: 'admin',
    actorRole: 'manager',
    actorName: ADMIN_NAME,
    summary: `${ADMIN_NAME} signed in${step !== null ? ' with an authenticator code' : ''}`,
    payload: { ip: ctx.ip, userAgent: ctx.userAgent },
  });

  await setSession({
    sub: 'admin',
    role: 'admin',
    name: ADMIN_NAME,
    ver: await adminSessionVersion(),
    cf: adminCredentialFingerprint(),
  });
  redirect('/admin');
}

/* ------------------------------------------------------------------ */
/* The manager acting on brothers' credentials                         */
/* ------------------------------------------------------------------ */

export interface IssuedCode {
  memberId: string;
  name: string;
  code: string;
  expiresAt: string;
}

/** One brother's setup code, from his roster row or record. */
export async function issueSetupCode(
  memberId: string,
): Promise<{ ok: boolean; message: string; issued?: IssuedCode }> {
  const admin = await requireAdmin();
  const member = await activeMember(memberId);
  if (!member) return { ok: false, message: 'No active member with that id.' };
  if (member.pinHash) {
    return { ok: false, message: `${member.name} already has a PIN. Reset it to issue a new code.` };
  }

  const { code, expiresAt } = await issueEnrollmentCode(member.id);
  await logEvent({
    action: 'auth.setup_code_issued',
    entityType: 'member',
    entityId: member.id,
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} issued a setup code for ${member.name}`,
    payload: { expiresAt: expiresAt.toISOString() },
  });
  revalidatePath('/admin/roster');
  return {
    ok: true,
    message: `Setup code for ${member.name}. It works once and expires in ${ENROLLMENT_TTL_DAYS} days.`,
    issued: { memberId: member.id, name: member.name, code, expiresAt: expiresAt.toISOString() },
  };
}

/**
 * Codes for every active brother without a PIN, in one go - for the start of
 * a semester. Returned once; only hashes are kept.
 */
export async function issueSetupCodesForAll(
  memberIds?: string[],
): Promise<{ ok: boolean; message: string; issued: IssuedCode[] }> {
  const admin = await requireAdmin();
  const targets = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(
      and(
        eq(members.active, true),
        isNull(members.pinHash),
        memberIds?.length ? inArray(members.id, memberIds) : undefined,
      ),
    )
    .orderBy(members.name);

  const issued: IssuedCode[] = [];
  for (const m of targets) {
    const { code, expiresAt } = await issueEnrollmentCode(m.id);
    issued.push({ memberId: m.id, name: m.name, code, expiresAt: expiresAt.toISOString() });
  }

  await logEvent({
    action: 'auth.setup_codes_issued',
    entityType: 'roster',
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} issued setup codes for ${issued.length} brother${issued.length === 1 ? '' : 's'}`,
    payload: { memberIds: issued.map((i) => i.memberId) },
  });
  revalidatePath('/admin/roster');
  return {
    ok: true,
    message: issued.length
      ? `${issued.length} setup code${issued.length === 1 ? '' : 's'} issued. They are shown once - copy or print them now.`
      : 'Everyone on the roster already has a PIN.',
    issued,
  };
}

/**
 * "I forgot my PIN." Clears it, ends every session he has, lifts any lockout,
 * and hands back a fresh setup code so the manager can pass it straight on.
 */
export async function resetMemberPin(
  memberId: string,
): Promise<{ ok: boolean; message: string; issued?: IssuedCode }> {
  const admin = await requireAdmin();
  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) return { ok: false, message: 'No such member.' };

  await db
    .update(members)
    .set({ pinHash: null, sessionVersion: member.sessionVersion + 1 })
    .where(eq(members.id, memberId));
  await clearThrottle(pinKey(memberId));
  await clearThrottle(enrollKey(memberId));
  const { code, expiresAt } = await issueEnrollmentCode(memberId);

  await logEvent({
    action: 'member.pin_reset',
    entityType: 'member',
    entityId: member.id,
    actorRole: 'manager',
    actorName: admin.name,
    summary: `${admin.name} reset ${member.name}'s PIN, signed out his sessions and issued a setup code`,
  });
  revalidatePath('/admin/roster');
  return {
    ok: true,
    message: `${member.name}'s PIN is cleared and he is signed out everywhere. Give him this code.`,
    issued: { memberId: member.id, name: member.name, code, expiresAt: expiresAt.toISOString() },
  };
}

/* ------------------------------------------------------------------ */

async function logAuth(
  action: string,
  member: { id: string; name: string },
  ctx: RequestContext,
  summary: string,
  extra: Record<string, unknown> = {},
) {
  await logEvent({
    action,
    entityType: 'member',
    entityId: member.id,
    actorRole: action.includes('failed') ? 'anonymous' : 'brother',
    actorMemberId: action.includes('failed') ? null : member.id,
    actorName: action.includes('failed') ? null : member.name,
    summary,
    payload: { ip: ctx.ip, userAgent: ctx.userAgent, ...extra },
  });
}
