/**
 * GET /api/late-plates/settings?date=YYYY-MM-DD
 * PUT /api/late-plates/settings
 *
 * The chefs' controls: move a cutoff, or close a meal to late plates outright.
 *
 * A cutoff resolves as day override -> standing value -> house default, and
 * saving one moves the standing value too, so tomorrow inherits it. Closing a
 * meal never carries forward: it is a decision about one service.
 */

import { NextRequest } from 'next/server.js';

import { todayInEastern } from '../../../../lib/dates.ts';
import {
  getLatePlateSettings,
  setLatePlateSettings,
  getStandingCutoffs,
  DEFAULT_CUTOFFS,
  SERVE_TIMES,
} from '../../../../lib/late-plate-service.ts';
import {
  actorNameOf,
  callerOf,
  canRead,
  canWrite,
  json,
  preflight,
  UNAUTHORIZED,
} from '../../../../lib/late-plate-api.ts';
import type { Meal } from '../../../../lib/types.ts';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function OPTIONS() {
  return preflight();
}

export async function GET(request: NextRequest) {
  const caller = await callerOf(request);
  if (!canRead(caller)) return json(UNAUTHORIZED, 401);

  const requested = request.nextUrl.searchParams.get('date');
  if (requested && !ISO_DATE.test(requested)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  const date = requested ?? todayInEastern();

  const [settings, standing] = await Promise.all([
    getLatePlateSettings(date),
    getStandingCutoffs(),
  ]);

  return json({
    success: true,
    date,
    /** The seed values. Only ever in force before anyone has saved a cutoff. */
    houseDefaults: DEFAULT_CUTOFFS,
    /** What each meal falls back to now - i.e. what tomorrow will use. */
    standing,
    serves: SERVE_TIMES,
    settings,
  });
}

export async function PUT(request: NextRequest) {
  const caller = await callerOf(request);
  if (!canWrite(caller)) return json(UNAUTHORIZED, 401);

  let body: {
    date?: string;
    lunch?: { cutoff?: string; closed?: boolean };
    dinner?: { cutoff?: string; closed?: boolean };
    /** false to move a cutoff for this day only. Defaults to true. */
    carryForward?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const date = body.date ?? todayInEastern();
  if (!ISO_DATE.test(date)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  const changes: Partial<Record<Meal, { cutoff?: string; closed?: boolean }>> = {};
  if (body.lunch) changes.lunch = body.lunch;
  if (body.dinner) changes.dinner = body.dinner;
  if (Object.keys(changes).length === 0) {
    return json({ error: 'Nothing to change. Send lunch and/or dinner.' }, 400);
  }

  const result = await setLatePlateSettings(date, changes, actorNameOf(caller), {
    carryForward: body.carryForward !== false,
  });
  if (!result.ok) return json({ ok: false, message: result.message }, 400);

  const [settings, standing] = await Promise.all([
    getLatePlateSettings(date),
    getStandingCutoffs(),
  ]);

  return json({ ok: true, message: result.message, date, settings, standing });
}
