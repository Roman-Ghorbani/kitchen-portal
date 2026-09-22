/**
 * Menu - the brother's late plate page, menu first.
 *
 * The menu is the page; asking for a plate is one button on each meal card.
 * The order follows how a brother decides: which day -> what is served ->
 * can I still -> save me a plate. Everything is computed here on the server
 * (house clock, cutoffs, what he already has) and handed to one client
 * component that owns the day picker, the confirm sheet and the undo toast.
 */

import { redirect } from 'next/navigation';

import { getSession, getViewAs } from '../../../lib/session.ts';
import { getMemberById } from '../../../lib/member-queries.ts';
import {
  addDays,
  todayInEastern,
  parseISO,
  parseClock,
  formatClock,
  mondayOf,
  weekDates,
  dayIndex,
  houseClockMinutes,
  HOUSE_TIMEZONE,
} from '../../../lib/dates.ts';
import {
  mealWindowsForRange,
  myLatePlatesInRange,
  getMemberDietary,
  getMemberRecurringPlates,
  SERVE_TIMES,
  MEALS,
} from '../../../lib/late-plate-service.ts';
import { getDayMenu } from '../../../lib/menu-service.ts';
import { getActiveSemester } from '../../../lib/week-service.ts';
import { AppShell } from '../shell.tsx';
import { LatePlateRefresher } from './install-prompt.tsx';
import { MenuBoard, type BoardDay, type BoardMeal } from './menu-board.tsx';

export const dynamic = 'force-dynamic';

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function clock(hhmm: string): string {
  const m = parseClock(hhmm);
  return m === null ? hhmm : formatClock(m);
}

/** "2:49 PM" on the house clock, whatever timezone the server runs in. */
function houseTime(d: Date | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HOUSE_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function longDate(iso: string): string {
  const d = parseISO(iso);
  const weekday = WEEKDAY_NAMES[dayIndex(iso)];
  const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${weekday} ${d.getUTCDate()} ${month}`;
}

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');

  const viewAs = await getViewAs();
  if (session.role === 'admin' && !viewAs) redirect('/admin');
  const memberId = viewAs ?? session.sub;
  const readOnly = session.role === 'admin';
  const previewed = readOnly ? await getMemberById(memberId) : null;

  const params = await searchParams;
  const now = new Date();
  const today = todayInEastern(now);
  const thisMonday = mondayOf(today);
  // This week and next. Further out than that nobody has posted a menu, and
  // a cutoff two weeks away is not something anyone needs a button for yet.
  const weekOffset = params.week === 'next' ? 1 : 0;
  const monday = addDays(thisMonday, weekOffset * 7);
  const dates = weekDates(monday);

  const [windows, mine, dietary, recurring, menus, semester] = await Promise.all([
    mealWindowsForRange(dates, now),
    myLatePlatesInRange(memberId, dates[0], dates[6]),
    getMemberDietary(memberId),
    getMemberRecurringPlates(memberId),
    Promise.all(dates.map((d) => getDayMenu(d))),
    getActiveSemester().catch(() => null),
  ]);

  const enabled = (semester?.latePlatesEnabled ?? true) && !readOnly;
  const byKey = new Map(mine.map((r) => [`${r.date}:${r.meal}`, r]));
  const nowMinutes = houseClockMinutes(now);

  const days: BoardDay[] = dates.map((date, i) => {
    const menu = menus[i];
    const meals: BoardMeal[] = MEALS.map((meal) => {
      const w = windows.get(`${date}:${meal}`)!;
      const r = byKey.get(`${date}:${meal}`) ?? null;
      const cutoffMinutes = parseClock(w.cutoff);
      return {
        meal,
        served: w.served,
        serves: clock(SERVE_TIMES[meal]),
        items: menu?.[meal].items ?? [],
        menuStale: Boolean(menu?.stale),
        open: w.open,
        cutoffLabel: clock(w.cutoff),
        minutesLeft:
          w.open && date === today && cutoffMinutes !== null
            ? cutoffMinutes - nowMinutes
            : null,
        closedReason: w.closedReason,
        request: r
          ? {
              id: r.id,
              status: r.status,
              askedAt: houseTime(r.requestedAt),
              resolvedAt: houseTime(r.resolvedAt),
              flagLines: r.flags.lines,
              hasAllergen: r.flags.hasAllergen,
              hasDietary: r.flags.dietary.length > 0,
              note: r.note,
              reason: r.reason,
            }
          : null,
      };
    }).filter((m) => m.served);

    return {
      date,
      weekday: WEEKDAY_NAMES[dayIndex(date)],
      short: WEEKDAY_NAMES[dayIndex(date)].slice(0, 3),
      dayOfMonth: parseISO(date).getUTCDate(),
      isToday: date === today,
      isPast: date < today,
      meals,
    };
  });

  const firstMonth = parseISO(dates[0]).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  const lastMonth = parseISO(dates[6]).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  const rangeLabel =
    firstMonth === lastMonth
      ? `${parseISO(dates[0]).getUTCDate()}–${parseISO(dates[6]).getUTCDate()} ${lastMonth}`
      : `${parseISO(dates[0]).getUTCDate()} ${firstMonth} – ${parseISO(dates[6]).getUTCDate()} ${lastMonth}`;

  return (
    <AppShell
      session={session}
      active="/late-plate"
      viewingAs={previewed?.name ?? null}
      title="Menu"
      subtitle={longDate(today)}
    >
      <LatePlateRefresher />

      {semester?.latePlateMessage && (
        <div className="alert info" style={{ marginBottom: 16 }}>
          <div className="alert-body">
            <div className="alert-title">Announcement</div>
            {semester.latePlateMessage}
          </div>
        </div>
      )}

      {semester && semester.latePlatesEnabled === false && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <div className="alert-body">
            <div className="alert-title">Late plate requests are paused</div>
            The kitchen manager is testing the request tool. You can still see
            the menu; saving a plate is switched off until it opens.
          </div>
        </div>
      )}

      <MenuBoard
        days={days}
        today={today}
        weekOffset={weekOffset}
        weekLabel={`${weekOffset === 0 ? 'This week' : 'Next week'}`}
        rangeLabel={rangeLabel}
        enabled={enabled}
        readOnly={readOnly}
        dietary={{
          flags: dietary.flags,
          other: dietary.other ?? '',
          lines: dietary.summary.lines,
        }}
        recurring={recurring}
      />
    </AppShell>
  );
}
