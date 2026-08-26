/**
 * Late plates, brother side dashboard.
 *
 * Fast, intuitive, and engaging dashboard for brothers to browse upcoming menus,
 * manage recurring weekly schedules, request late plates, and track preparation
 * status in real-time.
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
  getMemberRecurringPlates,
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
import { RecurringSchedules } from './recurring-schedules.tsx';

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

  const [windows, mine, dietary, recurring, menus, semester] = await Promise.all([
    mealWindowsForRange(dates),
    myLatePlatesInRange(session.sub, dates[0], dates[dates.length - 1]),
    getMemberDietary(session.sub),
    getMemberRecurringPlates(session.sub),
    // Fetch menus for all days in the horizon so every meal shows what's cooking
    Promise.all(dates.map((d) => getDayMenu(d))),
    getActiveSemester().catch(() => null),
  ]);

  const latePlatesEnabled = semester?.latePlatesEnabled ?? true;
  const menuByDate = new Map<string, DayMenu | null>(
    dates.map((d, i) => [d, menus[i]]),
  );

  const byKey = new Map(mine.map((r) => [`${r.date}:${r.meal}`, r]));

  const todayMenu = menuByDate.get(today) ?? null;

  const todayWindows = MEALS.map((meal) => ({
    meal,
    window: windows.get(`${today}:${meal}`)!,
    request: byKey.get(`${today}:${meal}`) ?? null,
  })).filter((m) => m.window.served);

  const later = dates.slice(1);

  // Dashboard Stats Calculations
  const todayActivePlate = mine.find(
    (p) => p.date === today && (p.status === 'waiting' || p.status === 'ready'),
  );
  const weekActiveCount = mine.filter(
    (p) => p.status === 'waiting' || p.status === 'ready',
  ).length;

  return (
    <AppShell
      session={session}
      active="/late-plate"
      title="Late Plate Dashboard"
      subtitle="Browse menus, schedule recurring late plates, and track pickup in the student fridge"
    >
      {/* Testing Notice banner when Kitchen Manager has paused requesting */}
      {!latePlatesEnabled && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <div className="alert-body">
            <div className="alert-title">
              Late Plate Tool Testing Notice
            </div>
            The late plate request tool is currently being tested live by the
            kitchen manager. You can explore menus and upcoming meals below,
            but requesting is temporarily paused until it officially opens.
          </div>
        </div>
      )}

      {/* Brother Dashboard Stats Header */}
      <div className="lp-dashboard-hero">
        <div className="card card-pad lp-hero-stat">
          <div className="lp-hero-stat-label">Today&apos;s Status</div>
          <div className="lp-hero-stat-value">
            {todayActivePlate ? (
              <span style={{ color: todayActivePlate.status === 'ready' ? '#10b981' : 'var(--gold-400)' }}>
                {todayActivePlate.meal === 'lunch' ? '☀️ Lunch' : '🌙 Dinner'}{' '}
                {todayActivePlate.status === 'ready' ? 'Ready in Fridge' : 'In Queue'}
              </span>
            ) : (
              <span style={{ color: 'var(--ink-400)', fontSize: 16 }}>No requests today</span>
            )}
          </div>
          <div className="lp-hero-stat-sub">
            {todayActivePlate
              ? 'Stored in the student fridge upon service'
              : 'Request below before service cutoff'}
          </div>
        </div>

        <div className="card card-pad lp-hero-stat">
          <div className="lp-hero-stat-label">Upcoming This Week</div>
          <div className="lp-hero-stat-value">{weekActiveCount}</div>
          <div className="lp-hero-stat-sub">Plates requested across next 7 days</div>
        </div>

        <div className="card card-pad lp-hero-stat">
          <div className="lp-hero-stat-label">Recurring Schedules</div>
          <div className="lp-hero-stat-value">{recurring.length}</div>
          <div className="lp-hero-stat-sub">Weekly standing late plates</div>
        </div>

        <div className="card card-pad lp-hero-stat">
          <div className="lp-hero-stat-label">Your Dietary Profile</div>
          <div className="lp-hero-stat-value" style={{ fontSize: 14, fontWeight: 600 }}>
            {dietary.flags.length > 0 ? (
              <span style={{ color: 'var(--ink-900)' }}>
                ⚠️ {dietary.flags.join(', ')}
              </span>
            ) : (
              <span style={{ color: 'var(--ink-400)' }}>No allergies recorded</span>
            )}
          </div>
          <div className="lp-hero-stat-sub">Automatically attached to requests</div>
        </div>
      </div>

      {/* Standing Recurring Weekly Late Plates */}
      <RecurringSchedules
        schedules={recurring}
        disabled={!latePlatesEnabled}
      />

      {/* Today's Meal Section */}
      <div className="lp-today card card-pad">
        <div className="lp-today-head">
          <div>
            <div className="lp-eyebrow">Service Schedule</div>
            <h2 className="lp-today-title">Today — {weekday(today)}, {shortDate(today)}</h2>
          </div>
        </div>

        {todayWindows.length === 0 ? (
          <div className="note">No meals served today.</div>
        ) : (
          <div className="lp-meal-grid">
            {todayWindows.map(({ meal, window, request }) => {
              // If requested or active or declined, show the rich StatusTracker directly in place
              if (
                request &&
                (request.status === 'waiting' ||
                  request.status === 'ready' ||
                  request.status === 'declined')
              ) {
                return (
                  <StatusTracker
                    key={meal}
                    request={request}
                    window={window}
                    menu={todayMenu}
                    isToday
                  />
                );
              }

              // Otherwise render the interactive meal cell
              return (
                <MealCell
                  key={meal}
                  meal={meal}
                  window={window}
                  request={request}
                  dietary={dietary}
                  menu={todayMenu}
                  latePlatesEnabled={latePlatesEnabled}
                  isToday
                  prominent
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Rest of the week */}
      <div className="section-title" style={{ marginTop: 24 }}>Upcoming this week</div>

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
                    isToday={false}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="note" style={{ marginTop: 24 }}>
        <strong>How late plates work:</strong> A late plate is boxed during service and placed in the student fridge. 
        Request before the cutoff and pick it up whenever you return to the house. Allergies and dietary restrictions 
        travel with your request — the kitchen must confirm they have reviewed them before plating. If you cancel a 
        late plate on the day of service, you will not be able to re-request that same meal today.
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
  isToday = false,
  prominent = false,
}: {
  meal: Meal;
  window: MealWindow;
  request: LatePlateRow | null;
  dietary: MemberDietary;
  /** Menu from the kitchen TV Pi when available. */
  menu?: DayMenu | null;
  latePlatesEnabled?: boolean;
  isToday?: boolean;
  prominent?: boolean;
}) {
  const items = menu?.[meal].items ?? [];
  const isCancelledToday = isToday && request?.status === 'cancelled';
  const active =
    request && (request.status === 'waiting' || request.status === 'ready');

  return (
    <div className={`lp-meal${prominent ? ' prominent' : ''}`}>
      <div className="lp-meal-head">
        <div className="lp-meal-title-wrap">
          <span className="lp-meal-icon">{meal === 'lunch' ? '☀️' : '🌙'}</span>
          <span className="lp-meal-name">{meal}</span>
        </div>
        <StatusTag request={request} window={window} isToday={isToday} />
      </div>

      <div className="lp-meal-times">
        Serves {clock(SERVE_TIMES[meal])} · requests close {clock(window.cutoff)}
      </div>

      {/* Menu Highlight Area */}
      <div className="lp-menu-box">
        <div className="lp-menu-label">
          🍽️ On the menu{menu?.stale ? ' (last known)' : ''}
        </div>
        {items.length > 0 ? (
          <div className="lp-menu-items">
            {items.map((item, idx) => (
              <span key={idx} className="lp-menu-pill">
                {item}
              </span>
            ))}
          </div>
        ) : (
          <div className="lp-menu-empty">
            Menu not yet posted by the chef for this meal.
          </div>
        )}
      </div>

      {/* When cancelled on the day-of */}
      {isCancelledToday && (
        <div className="lp-cancelled-notice">
          🚫 You cancelled this request earlier today. Re-requesting this meal on the day of service is not permitted.
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
            isDayOf={isToday}
          />
        </>
      ) : !isCancelledToday && window.open ? (
        <PlateButton
          mode="request"
          date={window.date}
          meal={meal}
          defaultFlags={dietary.flags}
          defaultOther={dietary.other ?? ''}
          disabled={!latePlatesEnabled}
          disabledReason="Late plate requests are paused for testing."
        />
      ) : !isCancelledToday ? (
        <div className="lp-closed">{window.closedReason}</div>
      ) : null}
    </div>
  );
}

function StatusTag({
  request,
  window,
  isToday = false,
}: {
  request: LatePlateRow | null;
  window: MealWindow;
  isToday?: boolean;
}) {
  if (request?.status === 'ready') return <span className="tag ok">Ready</span>;
  if (request?.status === 'waiting') return <span className="tag jun">Requested</span>;
  if (request?.status === 'declined') return <span className="tag bad">Declined</span>;
  if (isToday && request?.status === 'cancelled') return <span className="tag locked">Cancelled</span>;
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
