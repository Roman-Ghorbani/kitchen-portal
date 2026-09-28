/**
 * GET /api/tv/late-plates
 *
 * Today's late plate queue as the dining room display shows it: per-meal
 * counts and the names waiting or ready. Deliberately nothing else - no
 * notes, no allergens, no member ids. The house display runs in a kiosk
 * browser anybody in the dining room can reach, so it only ever receives what
 * is fine to put on a wall.
 *
 * Same key as /api/tv/schedule, which is read-only; the display no longer
 * holds the kitchen tablet's write-capable credential.
 */

import { NextRequest } from 'next/server.js';

import { todayInEastern } from '../../../../lib/dates.ts';
import {
  listLatePlates,
  mealWindow,
  currentKitchenMeal,
  getLatePlateSettings,
  MEALS,
} from '../../../../lib/late-plate-service.ts';
import { formatClock, parseClock } from '../../../../lib/dates.ts';
import { callerOf, hasDisplayKey, json, UNAUTHORIZED } from '../../../../lib/api-auth.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!hasDisplayKey(request)) {
    const caller = await callerOf(request);
    if (caller.session?.role !== 'admin') return json(UNAUTHORIZED, 401);
  }

  try {
    const date = todayInEastern();
    const [plates, settings] = await Promise.all([
      listLatePlates(date, { includeClosed: false }),
      getLatePlateSettings(date),
    ]);

    const meals: Record<string, unknown> = {};
    for (const meal of MEALS) {
      const window = await mealWindow(date, meal);
      const forMeal = plates.filter((p) => p.meal === meal);
      const cutoff = parseClock(settings[meal].cutoff);
      meals[meal] = {
        cutoff: cutoff === null ? null : formatClock(cutoff),
        open: window.open,
        served: window.served,
        closed: window.closedReason !== null,
        toMake: forMeal.filter((p) => p.status === 'waiting').length,
        ready: forMeal.filter((p) => p.status === 'ready').length,
      };
    }

    return json({
      success: true,
      date,
      currentMeal: currentKitchenMeal(),
      meals,
      plates: plates
        .filter((p) => p.status === 'waiting' || p.status === 'ready')
        .map((p) => ({ name: p.name, meal: p.meal, status: p.status })),
    });
  } catch (error) {
    console.error('[tv/late-plates] failed', error);
    return json({ success: false, error: 'Failed to load late plates' }, 500);
  }
}
