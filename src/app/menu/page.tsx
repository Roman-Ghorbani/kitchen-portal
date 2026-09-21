import { cookies, headers } from 'next/headers';
import { getSession, getViewAs } from '../../lib/session.ts';
import { getMemberById } from '../../lib/member-queries.ts';
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
import { AppShell } from '../(app)/shell.tsx';

export const dynamic = 'force-dynamic';

export default async function MenuPage({
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

  // If user is signed in to the portal (brother or admin), show inside AppShell
  if (session) {
    const viewAs = await getViewAs();
    const previewed = viewAs ? await getMemberById(viewAs) : null;

    return (
      <AppShell
        session={session}
        active="/menu"
        viewingAs={previewed?.name ?? null}
        title="Weekly Menu"
        subtitle="At a glance view of lunch & dinner for the brotherhood"
      >
        <SeniorWeekMenu
          mode="in-app"
          weekStart={weekStart}
          currentMonday={currentMonday}
          todayIso={todayIso}
          days={days}
        />
      </AppShell>
    );
  }

  // If user is not logged into the portal (e.g. senior, parent, or guest)
  const menuToken = cookieStore.get(MENU_AUTH_COOKIE)?.value;
  const isMenuAuthenticated = verifyMenuToken(menuToken);

  if (!isMenuAuthenticated) {
    const clientIp = getClientIp(reqHeaders);
    const limit = checkRateLimit(clientIp);

    return (
      <MenuPasswordGate
        initialLocked={!limit.allowed}
        initialRetryAfterMs={limit.retryAfterMs}
      />
    );
  }

  return (
    <SeniorWeekMenu
      mode="standalone"
      weekStart={weekStart}
      currentMonday={currentMonday}
      todayIso={todayIso}
      days={days}
    />
  );
}
