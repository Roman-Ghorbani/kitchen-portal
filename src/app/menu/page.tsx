import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession, getViewAs } from '../../lib/session.ts';
import { getMemberById } from '../../lib/member-queries.ts';
import {
  MENU_AUTH_COOKIE,
  verifyMenuToken,
  seniorMenuPasswordSet,
} from '../../lib/senior-menu-auth.ts';
import { checkThrottle } from '../../lib/throttle.ts';
import { requestContext } from '../../lib/request-context.ts';
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
  const [cookieStore, session, params] = await Promise.all([
    cookies(),
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
    // Brothers have the menu-first late plate page as their Menu tab; this
    // weekly view stays for seniors without an account and for managers.
    if (session.role === 'brother' || viewAs) redirect('/late-plate');
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

  // Not signed in to the portal: a senior, a parent, an alum.
  if (!(await verifyMenuToken(cookieStore.get(MENU_AUTH_COOKIE)?.value))) {
    const { ip } = await requestContext();
    const gate = await checkThrottle([`menu:${ip}`, `ip:${ip}`]);
    return (
      <MenuPasswordGate
        configured={await seniorMenuPasswordSet()}
        initialRetryAfterMs={gate.retryAfter * 1000}
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
