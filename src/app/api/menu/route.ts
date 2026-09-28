/**
 * GET /api/menu    menus for one day or a range of days
 * PUT /api/menu    the chefs save a day (or several)
 *
 * The chefs enter menus on the kitchen tablet, and this is the store they
 * write to. Brothers read menus through their own pages and the house display
 * through /api/tv/schedule, so this endpoint only needs to serve the tablet
 * and the manager: reading needs any signed-in caller, writing needs the
 * manager or a paired tablet.
 */

import { NextRequest } from 'next/server.js';

import { todayInEastern, addDays, dayIndex } from '../../../lib/dates.ts';
import { getDayMenu, saveDayMenu, saveWeekMenus } from '../../../lib/menu-service.ts';
import { callerOf, canRead, canWrite, json, UNAUTHORIZED } from '../../../lib/api-auth.ts';

export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 35;

/**
 * Query parameters:
 *   date       YYYY-MM-DD, "today" or "tomorrow" - a single day
 *   startDate  YYYY-MM-DD - first day of a range (default today)
 *   days       length of the range, 1-35 (default 7)
 */
export async function GET(request: NextRequest) {
  const caller = await callerOf(request);
  if (!canRead(caller)) return json(UNAUTHORIZED, 401);

  const params = request.nextUrl.searchParams;
  const today = todayInEastern();
  const dateParam = params.get('date');

  if (dateParam) {
    const date =
      dateParam === 'today' ? today : dateParam === 'tomorrow' ? addDays(today, 1) : dateParam;
    if (!ISO_DATE.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);

    const menu = await getDayMenu(date);
    return json({
      success: true,
      date,
      dayOfWeek: DAY_NAMES[dayIndex(date)],
      isToday: date === today,
      menu: menu
        ? { hasMenu: menu.hasMenu, stale: menu.stale, lunch: menu.lunch, dinner: menu.dinner }
        : null,
    });
  }

  const start = params.get('startDate') ?? today;
  if (!ISO_DATE.test(start)) return json({ error: 'startDate must be YYYY-MM-DD' }, 400);
  const count = Math.min(Math.max(Number(params.get('days')) || 7, 1), MAX_DAYS);
  const dates = Array.from({ length: count }, (_, i) => addDays(start, i));
  const menus = await Promise.all(dates.map((d) => getDayMenu(d)));

  const days = dates.map((date, i) => ({
    date,
    dayOfWeek: DAY_NAMES[dayIndex(date)],
    isToday: date === today,
    hasMenu: menus[i]?.hasMenu ?? false,
    stale: menus[i]?.stale ?? false,
    lunch: menus[i]?.lunch ?? { label: 'Lunch', serve: '', items: [] },
    dinner: menus[i]?.dinner ?? { label: 'Dinner', serve: '', items: [] },
  }));

  return json({
    success: true,
    today,
    timezone: 'America/New_York',
    daysCount: days.length,
    todayMenu: days[0],
    tomorrowMenu: days[1] ?? null,
    days,
  });
}

/**
 * Body: `{ date, lunch: string[], dinner: string[] }` for one day, or
 * `{ menus: { [date]: { lunch, dinner } } }` for several.
 */
export async function PUT(request: NextRequest) {
  const caller = await callerOf(request);
  if (!canWrite(caller)) return json(UNAUTHORIZED, 401);

  let body: {
    date?: string;
    lunch?: string[];
    dinner?: string[];
    menus?: Record<string, { lunch?: string[]; dinner?: string[] }>;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  if (body.menus && typeof body.menus === 'object') {
    if (!Object.keys(body.menus).every((d) => ISO_DATE.test(d))) {
      return json({ error: 'menus must be keyed by YYYY-MM-DD' }, 400);
    }
    await saveWeekMenus(body.menus);
    return json({ success: true, message: 'Menus saved.' });
  }

  const date = body.date ?? todayInEastern();
  if (!ISO_DATE.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);

  const menu = await saveDayMenu(date, { lunch: body.lunch, dinner: body.dinner });
  return json({ success: true, date, menu });
}
