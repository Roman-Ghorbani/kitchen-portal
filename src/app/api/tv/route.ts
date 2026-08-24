import { NextRequest, NextResponse } from 'next/server.js';
import { todayInEastern, mondayOf, addDays, dayIndex } from '../../../lib/dates.ts';
import { getWeek, getActiveSemester, type DisplaySlot } from '../../../lib/week-service.ts';
import { getOpenShifts } from '../../../lib/shift-service.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  // Optional API Key check if TV_API_KEY is configured in env
  const expectedApiKey = process.env.TV_API_KEY;
  if (expectedApiKey) {
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const headerKey = request.headers.get('x-api-key');
    const queryKey = request.nextUrl.searchParams.get('key');

    const providedKey = queryKey || headerKey || bearerToken;
    if (providedKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing API key' },
        { status: 401, headers: CORS_HEADERS },
      );
    }
  }

  try {
    const activeSemester = await getActiveSemester().catch(() => null);
    const todayIso = todayInEastern();
    const tomorrowIso = addDays(todayIso, 1);

    const currentMonday = mondayOf(todayIso);
    const nextMonday = addDays(currentMonday, 7);

    const [currentWeek, nextWeek, openShifts] = await Promise.all([
      getWeek(currentMonday),
      getWeek(nextMonday),
      getOpenShifts().catch(() => []),
    ]);

    const formatDay = (dateIso: string, weekObj: typeof currentWeek) => {
      const dayData = weekObj?.days.find((d) => d.date === dateIso);
      const idx = dayIndex(dateIso);
      return {
        date: dateIso,
        dayOfWeek: DAY_NAMES[idx],
        isToday: dateIso === todayIso,
        lunch: formatTvSlot(dayData?.lunch ?? null, 'lunch'),
        dinner: formatTvSlot(dayData?.dinner ?? null, 'dinner'),
      };
    };

    const todayData = formatDay(todayIso, currentWeek || nextWeek);
    const tomorrowData = formatDay(
      tomorrowIso,
      currentWeek?.days.some((d) => d.date === tomorrowIso) ? currentWeek : nextWeek,
    );

    const formattedCurrentWeek = currentWeek
      ? {
          weekStart: currentWeek.weekStart,
          status: currentWeek.status,
          days: currentWeek.days.map((d) => formatDay(d.date, currentWeek)),
        }
      : null;

    const formattedNextWeek = nextWeek
      ? {
          weekStart: nextWeek.weekStart,
          status: nextWeek.status,
          days: nextWeek.days.map((d) => formatDay(d.date, nextWeek)),
        }
      : null;

    const getSummary = (day: typeof todayData, label: string) => {
      const parts: string[] = [];
      if (day.lunch && day.lunch.assignments.length > 0) {
        const names = day.lunch.assignments.map((a) => a.name).join(', ');
        parts.push(`Lunch (${day.lunch.dutyGroup}): ${names}`);
      }
      if (day.dinner && day.dinner.assignments.length > 0) {
        const names = day.dinner.assignments.map((a) => a.name).join(', ');
        parts.push(`Dinner (${day.dinner.dutyGroup}): ${names}`);
      }
      return parts.length > 0 ? `${label}: ${parts.join(' | ')}` : `${label}: No duty shifts scheduled`;
    };

    const payload = {
      success: true,
      timestamp: new Date().toISOString(),
      timezone: 'America/New_York',
      pollIntervalSeconds: 120,
      semester: activeSemester ? { id: activeSemester.id, name: activeSemester.name } : null,
      today: todayData,
      tomorrow: tomorrowData,
      currentWeek: formattedCurrentWeek,
      nextWeek: formattedNextWeek,
      openShifts: openShifts.map((s) => ({
        assignmentId: s.assignmentId,
        date: s.date,
        dayOfWeek: DAY_NAMES[dayIndex(s.date)],
        meal: s.meal,
        originalMemberName: s.originalName,
        status: s.status,
      })),
      summary: {
        today: getSummary(todayData, "Today's Duty"),
        tomorrow: getSummary(tomorrowData, "Tomorrow's Duty"),
        openShiftsCount: openShifts.length,
      },
    };

    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch TV schedule' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

function formatTvSlot(slot: DisplaySlot | null, mealType: 'lunch' | 'dinner') {
  if (!slot) return null;
  return {
    id: slot.id,
    meal: slot.meal,
    mealLabel: mealType === 'lunch' ? 'Lunch Cleanup' : 'Dinner Cleanup',
    time: mealType === 'lunch' ? '2:30 PM – 3:00 PM' : '7:30 PM – 9:00 PM',
    dutyGroup: mealType === 'lunch' ? 'Juniors' : 'Sophomores',
    size: slot.size,
    coverBounty: slot.coverBounty,
    assignments: slot.assignments.map((a) => ({
      id: a.id,
      memberId: a.memberId,
      name: a.coveredByName ? `${a.coveredByName} (covering for ${a.memberName})` : a.memberName,
      originalMemberName: a.memberName,
      status: a.status,
      isCovered: a.status === 'covered' || Boolean(a.coveredByName),
      coveredByName: a.coveredByName,
      isFlagged: a.status === 'flagged',
      isMakeup: a.isMakeup,
      multiplier: a.multiplier,
    })),
  };
}
