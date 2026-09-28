/**
 * GET /api/tv/schedule
 *
 * Everything the house display needs for its kitchen panel: today and
 * tomorrow's crews and menus, this week and next, and the open shifts.
 *
 * Read by the display on the same Pi, server to server, with TV_API_KEY in an
 * `X-API-Key` header. Names only - no points, no notes, nothing dietary. The
 * manager's session is accepted too, for checking the payload by hand.
 */

import { NextRequest } from 'next/server.js';
import { todayInEastern, mondayOf, addDays, dayIndex } from '../../../../lib/dates.ts';
import { getWeek, getActiveSemester, type DisplaySlot } from '../../../../lib/week-service.ts';
import { getOpenShifts } from '../../../../lib/shift-service.ts';
import { getDayMenu } from '../../../../lib/menu-service.ts';
import { callerOf, hasDisplayKey, json, UNAUTHORIZED } from '../../../../lib/api-auth.ts';

export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function GET(request: NextRequest) {
  if (!hasDisplayKey(request)) {
    const caller = await callerOf(request);
    if (caller.session?.role !== 'admin') return json(UNAUTHORIZED, 401);
  }

  try {
    const activeSemester = await getActiveSemester().catch(() => null);
    const todayIso = todayInEastern();
    const tomorrowIso = addDays(todayIso, 1);

    const currentMonday = mondayOf(todayIso);
    const nextMonday = addDays(currentMonday, 7);

    const [currentWeek, nextWeek, openShifts, todayMenu, tomorrowMenu] = await Promise.all([
      getWeek(currentMonday).catch(() => null),
      getWeek(nextMonday).catch(() => null),
      getOpenShifts().catch(() => []),
      getDayMenu(todayIso).catch(() => null),
      getDayMenu(tomorrowIso).catch(() => null),
    ]);

    const formatDay = (
      dateIso: string,
      weekObj: typeof currentWeek,
      menuObj: typeof todayMenu,
    ) => {
      const dayData = weekObj?.days.find((d) => d.date === dateIso);
      const idx = dayIndex(dateIso);
      const lunchItems = menuObj?.lunch?.items ?? [];
      const dinnerItems = menuObj?.dinner?.items ?? [];

      return {
        date: dateIso,
        dayOfWeek: DAY_NAMES[idx],
        isToday: dateIso === todayIso,
        lunch: formatTvSlot(dayData?.lunch ?? null, 'lunch', lunchItems),
        dinner: formatTvSlot(dayData?.dinner ?? null, 'dinner', dinnerItems),
        menu: {
          hasMenu: (menuObj?.hasMenu) ?? (lunchItems.length > 0 || dinnerItems.length > 0),
          lunch: lunchItems,
          dinner: dinnerItems,
        },
      };
    };

    const todayData = formatDay(todayIso, currentWeek || nextWeek, todayMenu);
    const tomorrowData = formatDay(
      tomorrowIso,
      currentWeek?.days.some((d) => d.date === tomorrowIso) ? currentWeek : nextWeek,
      tomorrowMenu,
    );

    const formattedCurrentWeek = currentWeek
      ? {
          weekStart: currentWeek.weekStart,
          status: currentWeek.status,
          days: currentWeek.days.map((d) => formatDay(d.date, currentWeek, null)),
        }
      : null;

    const formattedNextWeek = nextWeek
      ? {
          weekStart: nextWeek.weekStart,
          status: nextWeek.status,
          days: nextWeek.days.map((d) => formatDay(d.date, nextWeek, null)),
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

    return json(payload);
  } catch (error) {
    console.error('[tv/schedule] failed', error);
    return json({ success: false, error: 'Failed to build the schedule' }, 500);
  }
}

function formatTvSlot(
  slot: DisplaySlot | null,
  mealType: 'lunch' | 'dinner',
  menuItems: string[] = [],
) {
  if (!slot) {
    return {
      id: null,
      meal: mealType,
      mealLabel: mealType === 'lunch' ? 'Lunch Cleanup' : 'Dinner Cleanup',
      time: mealType === 'lunch' ? '2:30 PM – 3:00 PM' : '7:30 PM – 9:00 PM',
      dutyGroup: mealType === 'lunch' ? 'Lunch crew' : 'Dinner crew',
      size: 0,
      coverBounty: 1,
      assignments: [],
      menu: menuItems,
    };
  }
  return {
    id: slot.id,
    meal: slot.meal,
    mealLabel: mealType === 'lunch' ? 'Lunch Cleanup' : 'Dinner Cleanup',
    time: mealType === 'lunch' ? '2:30 PM – 3:00 PM' : '7:30 PM – 9:00 PM',
    dutyGroup: mealType === 'lunch' ? 'Lunch crew' : 'Dinner crew',
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
    menu: menuItems,
  };
}

