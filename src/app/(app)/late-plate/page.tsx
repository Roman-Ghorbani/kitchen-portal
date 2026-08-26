/**
 * Late plates, brother side.
 *
 * The whole design target is one tap. This has to be faster than walking to
 * the kitchen and writing your name on a box, or half the house will keep
 * writing on boxes and the chefs will end up running two systems - which is
 * worse for them than the Sharpie was.
 *
 * So: today is a full card with the buttons already on screen, and the rest of
 * the week is a compact list underneath. No date picker, no meal dropdown, no
 * confirm step.
 */

import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import {
  addDays,
  todayInEastern,
  parseISO,
  parseClock,
  formatClock,
} from '../../../lib/dates.ts';
import {
  mealWindowsForRange,
  myLatePlatesInRange,
  getMemberDietary,
  SERVE_TIMES,
  MEALS,
  type MealWindow,
  type LatePlateRow,
  type MemberDietary,
} from '../../../lib/late-plate-service.ts';
import { getDayMenu, type DayMenu } from '../../../lib/menu-service.ts';
import { getActiveSemester } from '../../../lib/week-service.ts';
import type { Meal } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { PlateButton } from './plate-button.tsx';
import { StatusTracker } from './status-tracker.tsx';

export const dynamic = 'force-dynamic';

/** Today plus six. Far enough to cover a known trip, short enough to scan. */
const HORIZON_DAYS = 7;

function weekday(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function clock(hhmm: string): string {
  const m = parseClock(hhmm);
  return m === null ? hhmm : formatClock(m);
}

export default async function LatePlatePage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role === 'admin') redirect('/admin');

  const today = todayInEastern();
  const dates = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));

  const [windows, mine, dietary, menus, semester] = await Promise.all([
    mealWindowsForRange(dates),
    myLatePlatesInRange(session.sub, dates[0], dates[dates.length - 1]),
    getMemberDietary(session.sub),
    // Fetch menus for all days in the horizon so every meal shows what's cooking
    Promise.all(dates.map((d) => getDayMenu(d))),
    getActiveSemester().catch(() => null),
  ]);

  const latePlatesEnabled = semester?.latePlatesEnabled ?? true;
  const menuByDate = new Map<string, DayMenu | null>(
    dates.map((d, i) => [d, menus[i]]),
  );

  const byKey = new Map(mine.map((r) => [`${r.date}:${r.meal}`, r]));

  // Live or recent requests for today specifically
  const todayLiveRequests = mine.filter(
    (r) =>
      r.date === today &&
      (r.status === 'waiting' || r.status === 'ready' || r.status === 'declined'),
  );

  const todayMenu = menuByDate.get(today) ?? null;

  const todayWindows = MEALS.map((meal) => ({
    meal,
    window: windows.get(`${today}:${meal}`)!,
    request: byKey.get(`${today}:${meal}`) ?? null,
  })).filter((m) => m.window.served);

  const later = dates.slice(1);

  return (
    <AppShell
      session={session}
      active="/late-plate"
      title="Late Plate"
      subtitle="Request the kitchen to set a plate aside"
    >
      {/* Testing Notice banner when Kitchen Manager has paused requesting */}
      {!latePlatesEnabled && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <div className="alert-body">
            <div className="alert-title">
              Late Plate Tool Testing Notice
            </div>
            The late plate request tool is currently being tested live by the
            kitchen manager. You can view the layout and menus below, but
            requesting is temporarily disabled until it officially opens.
          </div>
        </div>
      )}

      {/* Prominent Status Tracker for Today's Plate(s) */}
      {todayLiveRequests.length > 0 && (
        <div className="lp-status-section">
          <div className="section-title" style={{ marginTop: 0 }}>
            {todayLiveRequests.length === 1
              ? "Today's Active Late Plate"
              : "Today's Active Late Plates"}
          </div>
          <div className="lp-status-grid">
            {todayLiveRequests.map((req) => (
              <StatusTracker
                key={req.id}
                request={req}
                window={windows.get(`${today}:${req.meal}`)}
                menu={todayMenu}
              />
            ))}
          </div>
        </div>
      )}

      {/* Today's Meal Grid */}
      <div className="lp-today card card-pad">
        <div className="lp-today-head">
          <div>
            <h2 className="lp-today-title">Today</h2>
            <div className="lp-today-date">
              {weekday(today)}, {shortDate(today)}
            </div>
          </div>
        </div>

        {todayWindows.length === 0 ? (
          <div className="note">No meals served today.</div>
        ) : (
          <div className="lp-meal-grid">
            {todayWindows.map(({ meal, window, request }) => (
              <MealCell
                key={meal}
                meal={meal}
                window={window}
                request={request}
                dietary={dietary}
                menu={todayMenu}
                latePlatesEnabled={latePlatesEnabled}
                prominent
              />
            ))}
          </div>
        )}
      </div>

      <div className="section-title">Rest of the week</div>

      <div className="lp-days">
        {later.map((date) => {
          const dayMenu = menuByDate.get(date) ?? null;
          const cells = MEALS.map((meal) => ({
            meal,
            window: windows.get(`${date}:${meal}`)!,
            request: byKey.get(`${date}:${meal}`) ?? null,
          })).filter((c) => c.window.served);

          if (cells.length === 0) return null;

          return (
            <div key={date} className="lp-day card card-pad">
              <div className="lp-day-head">
                <span className="lp-day-name">{weekday(date)}</span>
                <span className="lp-day-date">{shortDate(date)}</span>
              </div>
              <div className="lp-meal-grid">
                {cells.map(({ meal, window, request }) => (
                  <MealCell
                    key={meal}
                    meal={meal}
                    window={window}
                    request={request}
                    dietary={dietary}
                    menu={dayMenu}
                    latePlatesEnabled={latePlatesEnabled}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="note">
        A late plate is boxed and set aside during service. Request before the
        cutoff and pick it up from the kitchen when you get back. Cutoffs are set
        by the chefs and can move — today lunch closes at{' '}
        {clock(windows.get(`${today}:lunch`)?.cutoff ?? '13:30')} and dinner at{' '}
        {clock(windows.get(`${today}:dinner`)?.cutoff ?? '16:00')}. If the chefs
        decline one, you will see their reason here. Allergies and dietary
        restrictions travel with the request — the kitchen has to confirm they
        have read them before the plate can be marked ready.
      </div>
    </AppShell>
  );
}

function MealCell({
  meal,
  window,
  request,
  dietary,
  menu = null,
  latePlatesEnabled = true,
  prominent = false,
}: {
  meal: Meal;
  window: MealWindow;
  request: LatePlateRow | null;
  dietary: MemberDietary;
  /** Menu from the kitchen TV Pi when available. */
  menu?: DayMenu | null;
  latePlatesEnabled?: boolean;
  prominent?: boolean;
}) {
  const items = menu?.[meal].items ?? [];
  const active =
    request && (request.status === 'waiting' || request.status === 'ready');

  return (
    <div className={`lp-meal${prominent ? ' prominent' : ''}`}>
      <div className="lp-meal-head">
        <span className="lp-meal-name">{meal}</span>
        <StatusTag request={request} window={window} />
      </div>

      <div className="lp-meal-times">
        Serves {clock(SERVE_TIMES[meal])} · requests close {clock(window.cutoff)}
      </div>

      {items.length > 0 && (
        <div className="lp-menu">
          <span className="lp-menu-label">
            On the menu{menu?.stale ? ' (last known)' : ''}
          </span>
          {items.join(' · ')}
        </div>
      )}

      {request?.status === 'declined' && (
        <div className="lp-declined">
          Chefs declined{request.reason ? `: ${request.reason}` : '.'}
        </div>
      )}

      {active ? (
        <>
          <div className="lp-submitted-time">
            Requested at {formatClockTime(request.requestedAt)}
          </div>
          {request.flags.hasAny && (
            <div
              className={`lp-flags-back${request.flags.hasAllergen ? ' has-allergen' : ''}`}
            >
              <span className="lp-flags-label">
                {request.acknowledgedAt
                  ? 'Kitchen confirmed'
                  : 'Kitchen will be shown'}
              </span>
              {request.flags.lines.join(' · ')}
            </div>
          )}
          {request.note && <div className="lp-note-back">“{request.note}”</div>}
          <PlateButton
            mode="cancel"
            id={request.id}
            alreadyReady={request.status === 'ready'}
          />
        </>
      ) : window.open ? (
        <PlateButton
          mode="request"
          date={window.date}
          meal={meal}
          defaultFlags={dietary.flags}
          defaultOther={dietary.other ?? ''}
          disabled={!latePlatesEnabled}
          disabledReason="Late plate requests are paused for testing."
        />
      ) : (
        <div className="lp-closed">{window.closedReason}</div>
      )}
    </div>
  );
}

function StatusTag({
  request,
  window,
}: {
  request: LatePlateRow | null;
  window: MealWindow;
}) {
  if (request?.status === 'ready') return <span className="tag ok">Ready</span>;
  if (request?.status === 'waiting') return <span className="tag jun">Requested</span>;
  if (request?.status === 'declined') return <span className="tag bad">Declined</span>;
  if (!window.open) return <span className="tag locked">Closed</span>;
  return <span className="tag ok">Open</span>;
}

function formatClockTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}
