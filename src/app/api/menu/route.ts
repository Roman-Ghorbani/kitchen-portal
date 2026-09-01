import { NextRequest, NextResponse } from 'next/server.js';
import { todayInEastern, addDays, dayIndex } from '../../../lib/dates.ts';
import { getDayMenu, type DayMenu } from '../../../lib/menu-service.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Menu-Token',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

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
 * Expected token for external apps to pull menu data.
 * Checks MENU_API_TOKEN, TV_API_KEY, or LATE_PLATE_DEVICE_TOKEN.
 */
function getExpectedToken(): string | null {
  return (
    process.env.MENU_API_TOKEN ||
    process.env.TV_API_KEY ||
    process.env.LATE_PLATE_DEVICE_TOKEN ||
    null
  );
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
 *  - token / key: API token (if not provided via headers)
 *
 * Headers:
 *  - Authorization: Bearer <token>
 *  - X-API-Key: <token>
 *  - X-Menu-Token: <token>
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
