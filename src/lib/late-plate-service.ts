/**
 * Late plates.
 *
 * A brother who cannot make a meal asks the kitchen to set one aside. Until
 * now that was a Sharpie and a stack of boxes on Chris's cart; this module is
 * the queue that replaces it.
 *
 * Two rules carry the whole design:
 *
 *  1. The cutoff is enforced here, on the server, against the house clock.
 *     The cutoff is the entire point of the chefs' control - a cutoff checked
 *     only in the browser is not a cutoff, it is a suggestion. Every write
 *     path in this file goes through `mealWindow` first.
 *
 *  2. Nothing is deleted. A cancelled or declined request keeps its row and
 *     changes status, because a name that silently vanishes from the chefs'
 *     list is worse than one marked "cancelled" - they cannot tell the
 *     difference between a man who changed his mind and a bug.
 */

import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
  latePlates,
  latePlateSettings,
  latePlateMealDefaults,
  members,
  events,
} from '../db/schema.ts';
import { getActiveSemester } from './week-service.ts';
import {
  todayInEastern,
  dayIndex,
  parseClock,
  formatClock,
  houseClockMinutes,
} from './dates.ts';
import {
  normaliseFlags,
  summariseFlags,
  type FlagSummary,
} from './dietary.ts';
import type { Meal, MealDayConfig } from './types.ts';

export const MEALS: readonly Meal[] = ['lunch', 'dinner'];

export type LatePlateStatus = 'waiting' | 'ready' | 'declined' | 'cancelled';

/** Statuses that count as a live request holding a slot in the queue. */
const OPEN_STATUSES: LatePlateStatus[] = ['waiting', 'ready'];

/**
 * Checks whether late plate requests are currently enabled across the house.
 */
export async function isLatePlateEnabled(): Promise<boolean> {
  const semester = await getActiveSemester().catch(() => null);
  return semester?.latePlatesEnabled ?? true;
}

/**
 * The cutoff a meal falls back to when nothing else has ever been set.
 *
 * These are the seed values, not the answer. A cutoff resolves in three steps:
 *
 *   1. an override the chefs set for that specific day
 *   2. the standing cutoff, i.e. whatever they last saved for that meal
 *   3. these
 *
 * Step 2 is what makes the chefs' changes stick. Move dinner to 4:30 on a
 * Tuesday and Wednesday opens at 4:30 too, without anyone setting it again.
 * These constants are only ever reached on a database that has never had a
 * cutoff saved.
 */
export const DEFAULT_CUTOFFS: Record<Meal, string> = {
  lunch: '13:30',
  dinner: '16:00',
};

/** Purely informational - shown to brothers so the cutoff makes sense. */
export const SERVE_TIMES: Record<Meal, string> = {
  lunch: '11:00',
  dinner: '16:30',
};

/**
 * When the kitchen stops thinking about lunch and starts thinking about dinner.
 *
 * Only one meal is ever out and being served at a time, so the chef screen
 * opens on whichever one is current rather than making them pick. 2:30 PM is
 * the end of lunch service, not the 1:00 PM request cutoff - plates asked for
 * before the cutoff are still being made and collected after it, and flipping
 * the screen away mid-service is exactly when one gets forgotten.
 *
 * The other meal is always one tap away and its count is always on screen, so
 * getting this boundary slightly wrong costs nobody anything.
 */
export const MEAL_HANDOVER = '14:30';

export function currentKitchenMeal(now: Date = new Date()): Meal {
  const handover = parseClock(MEAL_HANDOVER) ?? 14 * 60 + 30;
  return houseClockMinutes(now) < handover ? 'lunch' : 'dinner';
}

export interface LatePlateResult {
  ok: boolean;
  message: string;
}

export interface MealWindow {
  date: string;
  meal: Meal;
  /** "HH:MM" house clock - the override if one exists, else the default. */
  cutoff: string;
  /** True when a chef has shut this meal to late plates outright. */
  closed: boolean;
  /** Whether the house serves this meal on this day at all. */
  served: boolean;
  /** The only field callers should branch on. */
  open: boolean;
  /** Why it is shut, phrased for a brother to read. Null when open. */
  closedReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Standing cutoffs                                                    */
/* ------------------------------------------------------------------ */

export interface StandingCutoff {
  cutoff: string;
  /** True when this is still the seeded value nobody has changed. */
  isHouseDefault: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * What each meal's cutoff currently is, absent a per-day override.
 *
 * A malformed stored value falls back to the house default rather than being
 * handed on: `decideWindow` fails closed on an unparseable cutoff, and a typo
 * saved once should not shut a meal every day until somebody notices.
 */
export async function getStandingCutoffs(): Promise<Record<Meal, StandingCutoff>> {
  const rows = await db.select().from(latePlateMealDefaults);

  const out = {} as Record<Meal, StandingCutoff>;
  for (const meal of MEALS) {
    const row = rows.find((r) => r.meal === meal);
    const usable = row && parseClock(row.cutoff) !== null ? row : null;
    out[meal] = {
      cutoff: usable?.cutoff ?? DEFAULT_CUTOFFS[meal],
      isHouseDefault: !usable,
      updatedAt: usable?.updatedAt ?? null,
      updatedBy: usable?.updatedBy ?? null,
    };
  }
  return out;
}

/** Moves a meal's standing cutoff. Tomorrow, and every day after, uses it. */
async function saveStandingCutoff(
  meal: Meal,
  cutoff: string,
  actorName: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(latePlateMealDefaults)
    .where(eq(latePlateMealDefaults.meal, meal))
    .limit(1);

  if (existing) {
    await db
      .update(latePlateMealDefaults)
      .set({ cutoff, updatedAt: new Date(), updatedBy: actorName })
      .where(eq(latePlateMealDefaults.id, existing.id));
  } else {
    await db
      .insert(latePlateMealDefaults)
      .values({ meal, cutoff, updatedAt: new Date(), updatedBy: actorName });
  }
}

/* ------------------------------------------------------------------ */
/* The window                                                          */
/* ------------------------------------------------------------------ */

/**
 * Whether `meal` on `date` is currently accepting requests, and why not.
 *
 * Deliberately takes `now` as a parameter so the branch table can be tested
 * without waiting for four o'clock.
 */
export async function mealWindow(
  date: string,
  meal: Meal,
  now: Date = new Date(),
): Promise<MealWindow> {
  const [override] = await db
    .select()
    .from(latePlateSettings)
    .where(and(eq(latePlateSettings.date, date), eq(latePlateSettings.meal, meal)))
    .limit(1);

  const [semester, standing] = await Promise.all([
    getActiveSemester().catch(() => null),
    getStandingCutoffs(),
  ]);
  const mealDays = (semester?.mealDays ?? null) as MealDayConfig | null;
  const served = mealDays ? Boolean(mealDays[meal][dayIndex(date)]) : true;

  // Day override, then the standing cutoff, then the house default.
  const cutoff = override?.cutoff ?? standing[meal].cutoff;
  // `closed` is never inherited: it is a decision about one service.
  const closed = Boolean(override?.closed);

  return decideWindow({
    date,
    meal,
    cutoff,
    closed,
    served,
    today: todayInEastern(now),
    clockMinutes: houseClockMinutes(now),
  });
}

/**
 * The decision itself, with every input already resolved.
 *
 * Split out from `mealWindow` so it is a pure function: no database, no clock,
 * no timezone lookup. The tests drive this directly.
 */
export function decideWindow(input: {
  date: string;
  meal: Meal;
  cutoff: string;
  closed: boolean;
  served: boolean;
  today: string;
  clockMinutes: number;
}): MealWindow {
  const { date, meal, cutoff, closed, served, today, clockMinutes } = input;

  const base = { date, meal, cutoff, closed, served };

  if (!served) {
    return {
      ...base,
      open: false,
      closedReason: `The house does not serve ${meal} that day.`,
    };
  }

  if (date < today) {
    return { ...base, open: false, closedReason: 'That meal has already passed.' };
  }

  if (closed) {
    return {
      ...base,
      open: false,
      closedReason: `The chefs have closed ${meal} late plates for that day.`,
    };
  }

  // A malformed override must not silently become "always open".
  const cutoffMinutes = parseClock(cutoff);
  if (cutoffMinutes === null) {
    return {
      ...base,
      open: false,
      closedReason: 'The cutoff for that meal is misconfigured. Tell Roman.',
    };
  }

  if (date === today && clockMinutes >= cutoffMinutes) {
    return {
      ...base,
      open: false,
      closedReason: `The ${formatClock(cutoffMinutes)} cutoff for ${meal} has passed.`,
    };
  }

  return { ...base, open: true, closedReason: null };
}

/**
 * The same decision for a run of days, in three queries rather than 2n.
 *
 * The brother-facing page renders a week at a time, and doing this one meal at
 * a time would re-read the semester row fourteen times to answer a question
 * that has not changed between them.
 */
export async function mealWindowsForRange(
  dates: string[],
  now: Date = new Date(),
): Promise<Map<string, MealWindow>> {
  const out = new Map<string, MealWindow>();
  if (dates.length === 0) return out;

  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));

  const [overrides, semester, standing] = await Promise.all([
    db
      .select()
      .from(latePlateSettings)
      .where(
        and(gte(latePlateSettings.date, from), lte(latePlateSettings.date, to)),
      ),
    getActiveSemester().catch(() => null),
    getStandingCutoffs(),
  ]);

  const mealDays = (semester?.mealDays ?? null) as MealDayConfig | null;
  const today = todayInEastern(now);
  const clockMinutes = houseClockMinutes(now);

  for (const date of dates) {
    for (const meal of MEALS) {
      const override = overrides.find((o) => o.date === date && o.meal === meal);
      out.set(
        `${date}:${meal}`,
        decideWindow({
          date,
          meal,
          cutoff: override?.cutoff ?? standing[meal].cutoff,
          closed: Boolean(override?.closed),
          served: mealDays ? Boolean(mealDays[meal][dayIndex(date)]) : true,
          today,
          clockMinutes,
        }),
      );
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface LatePlateRow {
  id: string;
  memberId: string;
  name: string;
  date: string;
  meal: Meal;
  status: LatePlateStatus;
  note: string | null;
  reason: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  /** Allergens and restrictions as they stood when he asked. */
  flags: FlagSummary;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

/** Everything for one day, both meals, newest request last. */
export async function listLatePlates(
  date: string,
  opts: { includeClosed?: boolean } = {},
): Promise<LatePlateRow[]> {
  const rows = await db
    .select({
      id: latePlates.id,
      memberId: latePlates.memberId,
      name: members.name,
      date: latePlates.date,
      meal: latePlates.meal,
      status: latePlates.status,
      note: latePlates.note,
      reason: latePlates.reason,
      requestedAt: latePlates.requestedAt,
      resolvedAt: latePlates.resolvedAt,
      flags: latePlates.flags,
      flagsOther: latePlates.flagsOther,
      acknowledgedAt: latePlates.acknowledgedAt,
      acknowledgedBy: latePlates.acknowledgedBy,
    })
    .from(latePlates)
    .innerJoin(members, eq(members.id, latePlates.memberId))
    .where(
      opts.includeClosed
        ? eq(latePlates.date, date)
        : and(
            eq(latePlates.date, date),
            inArray(latePlates.status, OPEN_STATUSES),
          ),
    );

  return rows
    .map(toRow)
    .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}

/* ------------------------------------------------------------------ */
/* Admin Management & Analytics                                        */
/* ------------------------------------------------------------------ */

/**
 * Lifts the re-request restriction for a brother who cancelled a plate.
 * Removes the cancelled row so they (or an admin) can submit a fresh request.
 */
export async function unblockLatePlate(
  latePlateId: string,
  adminName: string,
): Promise<LatePlateResult> {
  const [row] = await db
    .select({
      id: latePlates.id,
      memberId: latePlates.memberId,
      date: latePlates.date,
      meal: latePlates.meal,
      name: members.name,
    })
    .from(latePlates)
    .innerJoin(members, eq(members.id, latePlates.memberId))
    .where(eq(latePlates.id, latePlateId))
    .limit(1);

  if (!row) {
    return { ok: false, message: 'Request not found.' };
  }

  await db.delete(latePlates).where(eq(latePlates.id, latePlateId));

  await db.insert(events).values({
    action: 'late-plate.unblocked',
    entityType: 'late-plate',
    entityId: latePlateId,
    actorName: adminName,
    summary: `${adminName} unblocked late plate re-requesting for ${row.name} (${row.date} ${row.meal})`,
    payload: { memberId: row.memberId, date: row.date, meal: row.meal },
  });

  return {
    ok: true,
    message: `Re-requesting unblocked for ${row.name} on ${row.date} (${row.meal}).`,
  };
}

/**
 * Allows a kitchen manager to manually request a late plate for any brother,
 * bypassing cutoffs and closed meal gates.
 */
export async function adminManualRequest(
  adminName: string,
  memberId: string,
  date: string,
  meal: Meal,
  input: LatePlateRequest = {},
): Promise<LatePlateResult> {
  const [member] = await db
    .select({
      name: members.name,
      active: members.active,
      dietaryFlags: members.dietaryFlags,
      dietaryOther: members.dietaryOther,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) return { ok: false, message: 'Member not found on roster.' };

  const trimmed = input.note?.trim().slice(0, MAX_NOTE) || null;
  const flags =
    input.flags === undefined || input.flags === null
      ? normaliseFlags(member.dietaryFlags ?? [])
      : normaliseFlags(input.flags);
  const flagsOther =
    input.flagsOther === undefined
      ? (member.dietaryOther ?? null)
      : input.flagsOther?.trim().slice(0, MAX_NOTE) || null;

  const [existing] = await db
    .select()
    .from(latePlates)
    .where(
      and(
        eq(latePlates.memberId, memberId),
        eq(latePlates.date, date),
        eq(latePlates.meal, meal),
      ),
    )
    .limit(1);

  const values = {
    status: 'waiting' as const,
    note: trimmed,
    reason: null,
    flags,
    flagsOther,
    acknowledgedAt: null,
    acknowledgedBy: null,
    requestedAt: new Date(),
    resolvedAt: null,
  };

  if (existing) {
    await db.update(latePlates).set(values).where(eq(latePlates.id, existing.id));
  } else {
    await db.insert(latePlates).values({ memberId, date, meal, ...values });
  }

  await db.insert(events).values({
    action: 'late-plate.admin_manual_requested',
    entityType: 'late-plate',
    entityId: existing?.id ?? null,
    actorName: adminName,
    summary: `${adminName} manually placed a ${meal} late plate for ${member.name} (${date})`,
    payload: { date, meal, note: trimmed, flags, flagsOther },
  });

  return {
    ok: true,
    message: `Late plate placed for ${member.name} (${date} ${meal}).`,
  };
}

/**
 * Admin override of a plate's status (e.g. mark Ready, Decline with reason, or Reset to Waiting).
 */
export async function adminOverrideStatus(
  adminName: string,
  id: string,
  status: LatePlateStatus,
  reason?: string,
): Promise<LatePlateResult> {
  const [row] = await db
    .select({
      id: latePlates.id,
      name: members.name,
      meal: latePlates.meal,
      date: latePlates.date,
    })
    .from(latePlates)
    .innerJoin(members, eq(members.id, latePlates.memberId))
    .where(eq(latePlates.id, id))
    .limit(1);

  if (!row) return { ok: false, message: 'Request not found.' };

  await db
    .update(latePlates)
    .set({
      status,
      reason: status === 'declined' ? (reason?.trim() || 'Declined by manager') : null,
      resolvedAt: status === 'waiting' ? null : new Date(),
      acknowledgedAt: status === 'ready' ? new Date() : undefined,
      acknowledgedBy: status === 'ready' ? adminName : undefined,
    })
    .where(eq(latePlates.id, id));

  await db.insert(events).values({
    action: 'late-plate.admin_status_override',
    entityType: 'late-plate',
    entityId: id,
    actorName: adminName,
    summary: `${adminName} changed ${row.name}'s ${row.meal} plate on ${row.date} to ${status}`,
    payload: { status, reason },
  });

  return {
    ok: true,
    message: `Updated status for ${row.name}'s plate to ${status}.`,
  };
}

/** Shapes a joined row, folding the two flag columns into one summary. */
function toRow(r: {
  flags: string[] | null;
  flagsOther: string | null;
  status: string;
  meal: string;
  [k: string]: unknown;
}): LatePlateRow {
  const { flagsOther, ...rest } = r;
  return {
    ...(rest as unknown as Omit<LatePlateRow, 'flags' | 'meal' | 'status'>),
    meal: r.meal as Meal,
    status: r.status as LatePlateStatus,
    flags: summariseFlags(r.flags, flagsOther),
  };
}

/** One brother's requests for a day - what his own page renders. */
export async function getMyLatePlates(
  memberId: string,
  date: string,
): Promise<LatePlateRow[]> {
  const all = await listLatePlates(date, { includeClosed: true });
  return all.filter((r) => r.memberId === memberId);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

const MAX_NOTE = 140;

/**
 * Request a plate.
 *
 * `memberId` is always taken from the caller's session, never from a request
 * body - a brother can only ever put his own name in the queue.
 *
 * Re-requesting after cancelling reuses the existing row rather than inserting
 * a second one, which is what lets the one-per-man-per-meal unique index stand.
 */
export interface LatePlateRequest {
  note?: string | null;
  /** Flag ids from lib/dietary.ts. Anything unrecognised is dropped. */
  flags?: readonly string[] | null;
  flagsOther?: string | null;
  /**
   * Whether to write these flags back to his member record as his standing
   * ones. True from the request form; false when something is filling in on
   * his behalf and should not redefine his profile.
   */
  remember?: boolean;
}

/**
 * Request a plate.
 *
 * `memberId` is always taken from the caller's session, never from a request
 * body - a brother can only ever put his own name in the queue.
 *
 * Re-requesting after cancelling reuses the existing row rather than inserting
 * a second one, which is what lets the one-per-man-per-meal unique index stand.
 */
export async function requestLatePlate(
  memberId: string,
  date: string,
  meal: Meal,
  input: LatePlateRequest | string | null = null,
  now: Date = new Date(),
): Promise<LatePlateResult> {
  // A bare string is still accepted as "just a note", so older callers and the
  // smoke script do not need rewriting to pass an object.
  const req: LatePlateRequest =
    typeof input === 'string' || input === null ? { note: input } : input;

  const [semester, member] = await Promise.all([
    getActiveSemester().catch(() => null),
    db
      .select({
        name: members.name,
        active: members.active,
        dietaryFlags: members.dietaryFlags,
        dietaryOther: members.dietaryOther,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  if (semester && semester.latePlatesEnabled === false) {
    return {
      ok: false,
      message: 'Late plate requests are temporarily paused while the system is being tested.',
    };
  }

  if (!member) return { ok: false, message: 'That member is not on the roster.' };
  if (!member.active) {
    return { ok: false, message: 'Your roster entry is inactive. Talk to Roman.' };
  }

  const window = await mealWindow(date, meal, now);
  if (!window.open) {
    return { ok: false, message: window.closedReason ?? 'That meal is closed.' };
  }

  const trimmed = req.note?.trim().slice(0, MAX_NOTE) || null;

  /**
   * Flags default to whatever is on his member record. An omitted `flags` is
   * "use my usual", not "I have none" - the difference matters, because the
   * silent version of the second is how an allergy goes missing.
   */
  const flags =
    req.flags === undefined || req.flags === null
      ? normaliseFlags(member.dietaryFlags ?? [])
      : normaliseFlags(req.flags);
  const flagsOther =
    req.flagsOther === undefined
      ? (member.dietaryOther ?? null)
      : req.flagsOther?.trim().slice(0, MAX_NOTE) || null;

  const summary = summariseFlags(flags, flagsOther);

  const [existing] = await db
    .select()
    .from(latePlates)
    .where(
      and(
        eq(latePlates.memberId, memberId),
        eq(latePlates.date, date),
        eq(latePlates.meal, meal),
      ),
    )
    .limit(1);

  const today = todayInEastern(now);

  if (existing && OPEN_STATUSES.includes(existing.status as LatePlateStatus)) {
    return {
      ok: false,
      message: `You already have a ${meal} plate down for that day.`,
    };
  }

  // If cancelled on the day-of, one cannot re-request that meal today.
  if (date === today && existing && existing.status === 'cancelled') {
    return {
      ok: false,
      message: 'You already cancelled your late plate for this meal today. Re-requesting the same meal on the day of service is not permitted.',
    };
  }

  const values = {
    status: 'waiting' as const,
    note: trimmed,
    reason: null,
    flags,
    flagsOther,
    // A re-request is a fresh plate: whatever a chef acknowledged last time
    // was about the flags as they stood then, not these.
    acknowledgedAt: null,
    acknowledgedBy: null,
    requestedAt: now,
    resolvedAt: null,
  };

  if (existing) {
    await db.update(latePlates).set(values).where(eq(latePlates.id, existing.id));
  } else {
    await db.insert(latePlates).values({ memberId, date, meal, ...values });
  }

  if (req.remember) {
    await db
      .update(members)
      .set({ dietaryFlags: flags, dietaryOther: flagsOther })
      .where(eq(members.id, memberId));
  }

  await db.insert(events).values({
    action: 'late-plate.requested',
    entityType: 'late-plate',
    entityId: existing?.id ?? null,
    actorMemberId: memberId,
    actorName: member.name,
    summary:
      `${member.name} requested a ${meal} late plate for ${date}` +
      (summary.hasAny ? ` [${summary.lines.join(', ')}]` : '') +
      (trimmed ? ` — "${trimmed}"` : ''),
    payload: {
      date,
      meal,
      note: trimmed,
      flags,
      flagsOther,
      reRequested: Boolean(existing),
    },
  });

  return { ok: true, message: `${titleCase(meal)} plate requested for ${date}.` };
}

/**
 * A brother pulling his own request.
 *
 * Deliberately **not** bounded by the cutoff. The cutoff exists to stop new
 * work arriving late; a cancellation is the opposite — it removes work, and the
 * later it comes the more useful it is. Refusing it at four o'clock only meant
 * a chef made a plate nobody was ever going to collect.
 *
 * Allowed from `ready` too. That plate is already made, so cancelling does not
 * un-make it, but the kitchen still wants to know it will not be picked up.
 * Which is why the chef screen shows cancellations rather than hiding them.
 */
export async function cancelLatePlate(
  id: string,
  memberId: string,
  now: Date = new Date(),
): Promise<LatePlateResult> {
  const [row] = await db.select().from(latePlates).where(eq(latePlates.id, id)).limit(1);
  if (!row) return { ok: false, message: 'That request no longer exists.' };
  if (row.memberId !== memberId) {
    return { ok: false, message: 'You can only cancel your own late plate.' };
  }
  if (!OPEN_STATUSES.includes(row.status as LatePlateStatus)) {
    return { ok: false, message: 'That request is not active.' };
  }

  const wasReady = row.status === 'ready';

  const [member] = await db
    .select({ name: members.name })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  await db
    .update(latePlates)
    .set({ status: 'cancelled', resolvedAt: now })
    .where(eq(latePlates.id, id));

  await db.insert(events).values({
    action: 'late-plate.cancelled',
    entityType: 'late-plate',
    entityId: id,
    actorMemberId: memberId,
    actorName: member?.name ?? null,
    summary:
      `${member?.name ?? 'A brother'} cancelled his ${row.meal} late plate for ${row.date}` +
      (wasReady ? ' (it had already been plated)' : ''),
    payload: { date: row.date, meal: row.meal, wasReady },
  });

  const today = todayInEastern(now);
  const isDayOf = row.date === today;

  return {
    ok: true,
    message: wasReady
      ? `Cancelled — the kitchen had already plated it. ${isDayOf ? 'You cannot re-request this meal today.' : ''}`
      : isDayOf
      ? 'Cancelled. Since this was for today, you cannot request another plate for this meal today.'
      : 'Cancelled.',
  };
}

/**
 * The chef-side transition: waiting -> ready, or waiting -> declined.
 *
 * No cutoff check here on purpose. The cutoff governs what brothers may add,
 * not what the kitchen may do about what is already in front of them.
 *
 * **A flagged plate cannot be marked ready without an acknowledgement.** The
 * check lives here rather than in the tablet UI for the same reason the cutoff
 * does: a rule enforced only by a screen is not enforced. A tablet running last
 * month's JavaScript, or somebody poking the endpoint by hand, hits the same
 * wall - and the refusal names the flags, so whoever hit it learns why.
 */
export async function setLatePlateStatus(
  id: string,
  status: Extract<LatePlateStatus, 'waiting' | 'ready' | 'declined'>,
  reason: string | null,
  actorName: string,
  opts: { acknowledged?: boolean } = {},
): Promise<LatePlateResult> {
  const [row] = await db.select().from(latePlates).where(eq(latePlates.id, id)).limit(1);
  if (!row) return { ok: false, message: 'That request no longer exists.' };
  // A brother who has pulled out cannot have his plate marked ready or
  // declined behind his back. The screen greys these out; this is the rule.
  if (row.status === 'cancelled') {
    return {
      ok: false,
      message: 'He cancelled this request — there is nothing to make.',
    };
  }

  const flags = summariseFlags(row.flags, row.flagsOther);

  if (status === 'ready' && flags.hasAny && !opts.acknowledged) {
    return {
      ok: false,
      message: `Confirm you have read this plate's restrictions first: ${flags.lines.join(', ')}.`,
    };
  }

  const trimmed = reason?.trim().slice(0, MAX_NOTE) || null;
  const now = new Date();
  const acknowledging = status === 'ready' && flags.hasAny && opts.acknowledged;

  await db
    .update(latePlates)
    .set({
      status,
      reason: status === 'declined' ? trimmed : null,
      resolvedAt: status === 'waiting' ? null : now,
      ...(acknowledging ? { acknowledgedAt: now, acknowledgedBy: actorName } : {}),
    })
    .where(eq(latePlates.id, id));

  await db.insert(events).values({
    action: `late-plate.${status}`,
    entityType: 'late-plate',
    entityId: id,
    actorMemberId: null,
    actorName,
    summary:
      `${actorName} marked a ${row.meal} late plate for ${row.date} as ${status}` +
      (acknowledging ? `, acknowledging ${flags.lines.join(', ')}` : '') +
      (trimmed ? ` — "${trimmed}"` : ''),
    payload: {
      date: row.date,
      meal: row.meal,
      reason: trimmed,
      flags: flags.ids,
      flagsOther: row.flagsOther ?? null,
      acknowledged: Boolean(acknowledging),
    },
  });

  return {
    ok: true,
    message: acknowledging ? 'Marked ready, restrictions acknowledged.' : `Marked ${status}.`,
  };
}

/* ------------------------------------------------------------------ */
/* A brother's standing flags                                          */
/* ------------------------------------------------------------------ */

export interface MemberDietary {
  flags: string[];
  other: string | null;
  summary: FlagSummary;
}

/** What the request form pre-ticks. */
export async function getMemberDietary(memberId: string): Promise<MemberDietary> {
  const [row] = await db
    .select({ flags: members.dietaryFlags, other: members.dietaryOther })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  const flags = normaliseFlags(row?.flags ?? []);
  const other = row?.other ?? null;
  return { flags, other, summary: summariseFlags(flags, other) };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface MealSettings {
  /** The cutoff in force on this date, whatever it was inherited from. */
  cutoff: string;
  closed: boolean;
  /** True when no override exists for this specific day. */
  isDefault: boolean;
  /** What this meal would fall back to - i.e. what tomorrow will use. */
  standingCutoff: string;
  /** True when the standing cutoff has never been changed from the seed. */
  standingIsHouseDefault: boolean;
}

export async function getLatePlateSettings(
  date: string,
): Promise<Record<Meal, MealSettings>> {
  const [rows, standing] = await Promise.all([
    db.select().from(latePlateSettings).where(eq(latePlateSettings.date, date)),
    getStandingCutoffs(),
  ]);

  const out = {} as Record<Meal, MealSettings>;
  for (const meal of MEALS) {
    const row = rows.find((r) => r.meal === meal);
    out[meal] = {
      cutoff: row?.cutoff ?? standing[meal].cutoff,
      closed: Boolean(row?.closed),
      isDefault: !row,
      standingCutoff: standing[meal].cutoff,
      standingIsHouseDefault: standing[meal].isHouseDefault,
    };
  }
  return out;
}

/**
 * Applies a chef's change to a day, and — for a cutoff — to every day after it.
 *
 * A cutoff they move is a decision about how the house runs, so it becomes the
 * standing value. Closing a meal is a decision about one service, so it never
 * does: "kitchen closed for the night" must not mean closed tomorrow night too.
 * Pass `carryForward: false` to move a cutoff for one day only.
 */
export async function setLatePlateSettings(
  date: string,
  changes: Partial<Record<Meal, { cutoff?: string; closed?: boolean }>>,
  actorName: string,
  opts: { carryForward?: boolean } = {},
): Promise<LatePlateResult> {
  // Validate everything before writing anything, so a bad dinner time cannot
  // leave lunch half-saved.
  for (const [meal, change] of Object.entries(changes)) {
    if (!change) continue;
    if (!MEALS.includes(meal as Meal)) {
      return { ok: false, message: `"${meal}" is not a meal.` };
    }
    if (change.cutoff !== undefined && parseClock(change.cutoff) === null) {
      return { ok: false, message: `"${change.cutoff}" is not a valid HH:MM time.` };
    }
  }

  const carryForward = opts.carryForward !== false;
  const standing = await getStandingCutoffs();

  for (const meal of MEALS) {
    const change = changes[meal];
    if (!change) continue;

    const [existing] = await db
      .select()
      .from(latePlateSettings)
      .where(
        and(eq(latePlateSettings.date, date), eq(latePlateSettings.meal, meal)),
      )
      .limit(1);

    const next = {
      cutoff: change.cutoff ?? existing?.cutoff ?? standing[meal].cutoff,
      closed: change.closed ?? Boolean(existing?.closed),
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(latePlateSettings)
        .set(next)
        .where(eq(latePlateSettings.id, existing.id));
    } else {
      await db.insert(latePlateSettings).values({ date, meal, ...next });
    }

    const movedCutoff =
      change.cutoff !== undefined && change.cutoff !== standing[meal].cutoff;
    if (change.cutoff !== undefined && carryForward) {
      await saveStandingCutoff(meal, change.cutoff, actorName);
    }

    await db.insert(events).values({
      action: 'late-plate.settings',
      entityType: 'late-plate-settings',
      entityId: null,
      actorMemberId: null,
      actorName,
      summary:
        `${actorName} set ${meal} late plates for ${date} to ` +
        (next.closed ? 'closed' : `cutoff ${next.cutoff}`) +
        (movedCutoff && carryForward ? ' (from now on)' : ''),
      payload: { date, meal, ...next, carriedForward: movedCutoff && carryForward },
    });
  }

  return {
    ok: true,
    message: 'Saved.',
  };
}

/* ------------------------------------------------------------------ */

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One brother's live requests across a date range - what his page needs to
 * know which meals he is already down for, in one query rather than seven.
 */
export async function myLatePlatesInRange(
  memberId: string,
  from: string,
  to: string,
): Promise<LatePlateRow[]> {
  const rows = await db
    .select({
      id: latePlates.id,
      memberId: latePlates.memberId,
      name: members.name,
      date: latePlates.date,
      meal: latePlates.meal,
      status: latePlates.status,
      note: latePlates.note,
      reason: latePlates.reason,
      requestedAt: latePlates.requestedAt,
      resolvedAt: latePlates.resolvedAt,
      flags: latePlates.flags,
      flagsOther: latePlates.flagsOther,
      acknowledgedAt: latePlates.acknowledgedAt,
      acknowledgedBy: latePlates.acknowledgedBy,
    })
    .from(latePlates)
    .innerJoin(members, eq(members.id, latePlates.memberId))
    .where(
      and(
        eq(latePlates.memberId, memberId),
        gte(latePlates.date, from),
        lte(latePlates.date, to),
      ),
    );

  return rows
    .map(toRow)
    .sort((a, b) =>
      a.date === b.date ? a.meal.localeCompare(b.meal) : a.date < b.date ? -1 : 1,
    );
}
