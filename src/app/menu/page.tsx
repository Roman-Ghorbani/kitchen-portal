import { cookies, headers } from 'next/headers';
import { getSession } from '../../lib/session.ts';
import {
  MENU_AUTH_COOKIE,
  verifyMenuToken,
  getClientIp,
  checkRateLimit,
} from '../../lib/senior-menu-auth.ts';
import { getDayMenu } from '../../lib/menu-service.ts';
import { defaultScheduleMonday, weekDates, todayInEastern } from '../../lib/dates.ts';
import { MenuPasswordGate } from './menu-password-gate.tsx';
import { SeniorWeekMenu } from './senior-week-menu.tsx';

export const dynamic = 'force-dynamic';

export default async function SeniorMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const [cookieStore, reqHeaders, session, params] = await Promise.all([
    cookies(),
    headers(),
    getSession(),
    searchParams,
  ]);

  const menuToken = cookieStore.get(MENU_AUTH_COOKIE)?.value;
  const isMenuAuthenticated = verifyMenuToken(menuToken);
  const isUserAuthenticated = Boolean(session);

  // If not authenticated via persistent menu cookie or user session, show password gate
  if (!isMenuAuthenticated && !isUserAuthenticated) {
    const clientIp = getClientIp(reqHeaders);
    const limit = checkRateLimit(clientIp);

    return (
      <MenuPasswordGate
        initialLocked={!limit.allowed}
        initialRetryAfterMs={limit.retryAfterMs}
      />
    );
  }

  const todayIso = todayInEastern();
  const currentMonday = defaultScheduleMonday();
  const weekStart = params.week ?? currentMonday;

  const dates = weekDates(weekStart);
  const menus = await Promise.all(dates.map((d) => getDayMenu(d)));

  const days = dates.map((date, idx) => ({
    date,
    isToday: date === todayIso,
    isPast: date < todayIso,
    menu: menus[idx],
  }));

  return (
    <SeniorWeekMenu
      weekStart={weekStart}
      currentMonday={currentMonday}
      todayIso={todayIso}
      days={days}
    />
  );
}
