/**
 * GET  /api/late-plates?date=YYYY-MM-DD   the day's queue
 * POST /api/late-plates                   a brother requests a plate
 *
 * The GET shape is a flat JSON envelope with an explicit timezone and poll
 * interval, the same convention as /api/tv/schedule. Readable by a signed-in
 * brother, the manager, or a paired kitchen tablet.
 */

import { NextRequest } from 'next/server.js';

import { todayInEastern, formatClock, parseClock, dayIndex } from '../../../lib/dates.ts';
import {
  listLatePlates,
  mealWindow,
  getLatePlateSettings,
  requestLatePlate,
  currentKitchenMeal,
  MEALS,
  SERVE_TIMES,
} from '../../../lib/late-plate-service.ts';
import { callerOf, canRead, json, UNAUTHORIZED } from '../../../lib/api-auth.ts';
import type { Meal } from '../../../lib/types.ts';

export const dynamic = 'force-dynamic';

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const caller = await callerOf(request);
  if (!canRead(caller)) return json(UNAUTHORIZED, 401);

  const requested = request.nextUrl.searchParams.get('date');
  if (requested && !ISO_DATE.test(requested)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  const date = requested ?? todayInEastern();
  const includeClosed = request.nextUrl.searchParams.get('all') === '1';

  try {
    /**
     * Always read the whole day, then filter the list. Counts computed from a
     * pre-filtered list would report zero cancellations to any caller that did
     * not ask for them, which is how a screen ends up quietly disagreeing with
     * itself about how much is left to do.
     */
    const [everything, settings] = await Promise.all([
      listLatePlates(date, { includeClosed: true }),
      getLatePlateSettings(date),
    ]);

    const plates = includeClosed
      ? everything
      : everything.filter((p) => p.status === 'waiting' || p.status === 'ready');

    const meals: Record<string, unknown> = {};
    for (const meal of MEALS) {
      const window = await mealWindow(date, meal);
      const forMeal = everything.filter((p) => p.meal === meal);
      const count = (status: string) =>
        forMeal.filter((p) => p.status === status).length;
      meals[meal] = {
        serves: displayClock(SERVE_TIMES[meal]),
        cutoff: displayClock(settings[meal].cutoff),
        cutoff24: settings[meal].cutoff,
        usingDefaultCutoff: settings[meal].isDefault,
        /** What this meal falls back to - what tomorrow opens with. */
        standingCutoff24: settings[meal].standingCutoff,
        standingCutoff: displayClock(settings[meal].standingCutoff),
        closed: settings[meal].closed,
        served: window.served,
        open: window.open,
        closedReason: window.closedReason,
        // `toMake` is the only number the kitchen acts on: what is still
        // unaddressed. Everything else is history for the day.
        toMake: count('waiting'),
        ready: count('ready'),
        declined: count('declined'),
        cancelled: count('cancelled'),
        handled: count('ready') + count('declined') + count('cancelled'),
        flagged: forMeal.filter((p) => p.flags.hasAny).length,
        /** Kept for callers written against the first version of this shape. */
        waiting: count('waiting'),
      };
    }

    return json({
      success: true,
      timestamp: new Date().toISOString(),
      timezone: 'America/New_York',
      pollIntervalSeconds: 20,
      date,
      dayOfWeek: DAY_NAMES[dayIndex(date)],
      isToday: date === todayInEastern(),
      /** Which meal the kitchen is on right now - what a chef screen opens to. */
      currentMeal: currentKitchenMeal(),
      meals,
      latePlates: plates.map((p) => ({
        id: p.id,
        memberId: p.memberId,
        name: p.name,
        meal: p.meal,
        status: p.status,
        note: p.note,
        reason: p.reason,
        requestedAt: p.requestedAt.toISOString(),
        resolvedAt: p.resolvedAt?.toISOString() ?? null,
        /**
         * When cancelled. Null unless cancelled - a chef reading the screen
         * should not have to work out which timestamp means what.
         */
        cancelledAt:
          p.status === 'cancelled' ? (p.resolvedAt?.toISOString() ?? null) : null,
        // Labels, not ids, so a display never has to carry the catalogue.
        allergens: p.flags.allergens,
        dietary: p.flags.dietary,
        restrictions: p.flags.lines,
        flagIds: p.flags.ids,
        hasAllergen: p.flags.hasAllergen,
        needsAcknowledgement: p.flags.hasAny && p.acknowledgedAt === null,
        acknowledgedAt: p.acknowledgedAt?.toISOString() ?? null,
        acknowledgedBy: p.acknowledgedBy,
      })),
    });
  } catch (error) {
    console.error('[late-plates] GET failed', error);
    return json({ success: false, error: 'Failed to load late plates' }, 500);
  }
}

/**
 * A brother requesting his own plate.
 *
 * `memberId` is read from the session and any value in the body is ignored -
 * otherwise the endpoint would let anybody sign up anybody.
 */
export async function POST(request: NextRequest) {
  const caller = await callerOf(request);
  if (!caller.session || caller.session.role !== 'brother') {
    return json({ error: 'Sign in as a brother to request a late plate.' }, 401);
  }

  let body: {
    meal?: string;
    date?: string;
    note?: string;
    flags?: string[];
    flagsOther?: string;
    remember?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const meal = body.meal;
  if (meal !== 'lunch' && meal !== 'dinner') {
    return json({ error: "meal must be 'lunch' or 'dinner'" }, 400);
  }

  const date = body.date ?? todayInEastern();
  if (!ISO_DATE.test(date)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  const result = await requestLatePlate(caller.session.sub, date, meal as Meal, {
    note: typeof body.note === 'string' ? body.note : null,
    // Undefined means "use his standing flags"; an array means "these exactly".
    flags: Array.isArray(body.flags) ? body.flags : undefined,
    flagsOther: typeof body.flagsOther === 'string' ? body.flagsOther : undefined,
    remember: body.remember === true,
  });

  return json({ ok: result.ok, message: result.message }, result.ok ? 201 : 409);
}

/** "13:00" -> "1:00 PM", leaving a malformed override visible rather than hidden. */
function displayClock(hhmm: string): string {
  const minutes = parseClock(hhmm);
  return minutes === null ? hhmm : formatClock(minutes);
}
