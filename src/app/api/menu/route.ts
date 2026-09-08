import { NextRequest, NextResponse } from 'next/server.js';
import { todayInEastern, addDays, dayIndex } from '../../../lib/dates.ts';
import {
  getDayMenu,
  saveDayMenu,
  saveWeekMenus,
  type DayMenu,
} from '../../../lib/menu-service.ts';
import { callerOf, canWrite, CORS_HEADERS } from '../../../lib/late-plate-api.ts';

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * Optional token check for external apps if MENU_API_TOKEN is strictly set.
 */
function getExpectedToken(): string | null {
  return process.env.MENU_API_TOKEN || null;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * GET /api/menu
 *
 * Query parameters:
 *  - date: "YYYY-MM-DD", "today", or "tomorrow" (returns single day)
 *  - days: number of days to fetch starting from date (default 7)
 *  - token / key: API token (if MENU_API_TOKEN is strictly configured)
 */
export async function GET(request: NextRequest) {
  const expectedToken = getExpectedToken();

  if (expectedToken) {
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;
    const headerKey =
      request.headers.get('x-api-key') || request.headers.get('x-menu-token');
    const queryToken =
      request.nextUrl.searchParams.get('token') ||
      request.nextUrl.searchParams.get('key');

    const providedToken = queryToken || headerKey || bearerToken;

    if (providedToken !== expectedToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: Invalid or missing API token for menu access.',
        },
        { status: 401, headers: CORS_HEADERS },
      );
    }
  }

  try {
    const today = todayInEastern();
    const dateParam = request.nextUrl.searchParams.get('date');
    const daysParam = request.nextUrl.searchParams.get('days');

    // Single specific day requested
    if (dateParam && dateParam !== 'week') {
      let targetDate = dateParam;
      if (dateParam === 'today') targetDate = today;
      else if (dateParam === 'tomorrow') targetDate = addDays(today, 1);

      const menu = await getDayMenu(targetDate);
      const idx = dayIndex(targetDate);

      return NextResponse.json(
        {
          success: true,
          date: targetDate,
          dayOfWeek: DAY_NAMES[idx],
          isToday: targetDate === today,
          menu: menu
            ? {
                hasMenu: menu.hasMenu,
                stale: menu.stale,
                lunch: menu.lunch,
                dinner: menu.dinner,
              }
            : null,
        },
        { headers: CORS_HEADERS },
      );
    }

    // Horizon / multiple days (default 7 days)
    const numDays = Math.min(Math.max(Number(daysParam) || 7, 1), 14);
    const dates = Array.from({ length: numDays }, (_, i) => addDays(today, i));

    const menus = await Promise.all(dates.map((d) => getDayMenu(d)));

    const days = dates.map((d, i) => {
      const menu = menus[i];
      const idx = dayIndex(d);
      return {
        date: d,
        dayOfWeek: DAY_NAMES[idx],
        isToday: d === today,
        hasMenu: menu?.hasMenu ?? false,
        stale: menu?.stale ?? false,
        lunch: menu?.lunch ?? { label: 'Lunch', serve: '', items: [] },
        dinner: menu?.dinner ?? { label: 'Dinner', serve: '', items: [] },
      };
    });

    return NextResponse.json(
      {
        success: true,
        today,
        timezone: 'America/New_York',
        daysCount: days.length,
        todayMenu: days[0],
        tomorrowMenu: days[1] ?? null,
        days,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch menu data',
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * PUT /api/menu
 *
 * Saves or updates menu items for a single day or batch of days.
 * Requires admin session or kitchen kiosk device token.
 */
export async function PUT(request: NextRequest) {
  const caller = await callerOf(request);
  if (!canWrite(caller)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Admin or kitchen device token required.' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  try {
    const body = await request.json();

    if (body.menus && typeof body.menus === 'object') {
      await saveWeekMenus(body.menus);
      return NextResponse.json(
        { success: true, message: 'Batch menus saved successfully' },
        { headers: CORS_HEADERS },
      );
    }

    const date = body.date || todayInEastern();
    const updated = await saveDayMenu(date, {
      lunch: body.lunch,
      dinner: body.dinner,
    });

    return NextResponse.json(
      { success: true, date, menu: updated },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save menu data',
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  return PUT(request);
}

