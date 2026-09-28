/**
 * Home - the one place a brother looks to find out what he owes.
 *
 * This merges what used to be two competing answers to the same question: the
 * old /my-shifts page and the hero that sat on top of the schedule board and
 * then linked across to it. Availability lives here too, as a card rather than
 * a permanent tab, because it is set once a semester and was spending a nav
 * slot on a surface nobody opens twice.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession, getViewAs } from '../../lib/session.ts';
import { getMyShifts, getMemberById } from '../../lib/member-queries.ts';
import { getScheduleHorizon } from '../../lib/week-service.ts';
import { getStandings } from '../../lib/standings.ts';
import { getOpenShifts } from '../../lib/shift-service.ts';
import { getMyConflicts } from '../actions/availability-actions.ts';
import {
  parseISO,
  daysBetween,
  todayInEastern,
  houseClockMinutes,
} from '../../lib/dates.ts';
import { formatPoints } from '../../lib/types.ts';
import { AppShell } from './shell.tsx';
import { HorizonNote } from './horizon-note.tsx';
import { OfferShiftButton } from './offer-button.tsx';
import { CalendarSyncButton } from './calendar-sync-button.tsx';
import { calendarFeedToken } from '../../lib/calendar-feed.ts';
import { HistoryList, type HistoryEntry } from './history-list.tsx';

export const dynamic = 'force-dynamic';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function weekday(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function dateLine(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
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

function whenPhrase(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

function greeting(): string {
  const m = houseClockMinutes();
  if (m < 12 * 60) return 'Morning';
  if (m < 17 * 60) return 'Afternoon';
  return 'Evening';
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect('/signin');

  // A manager can look through one brother's eyes; otherwise admins go home.
  const viewAs = await getViewAs();
  if (session.role === 'admin' && !viewAs) redirect('/admin');
  const memberId = viewAs ?? session.sub;
  const readOnly = session.role === 'admin';

  const [member, shifts, horizon, standings, openShifts, conflicts] =
    await Promise.all([
      getMemberById(memberId),
      getMyShifts(memberId),
      getScheduleHorizon(),
      getStandings(memberId),
      getOpenShifts(),
      getMyConflicts(memberId),
    ]);

  const today = todayInEastern();
  const upcoming = shifts.filter((s) => s.date >= today);
  const past = shifts.filter((s) => s.date < today).reverse();
  const next = upcoming[0];
  const later = upcoming.slice(1);

  // Seats anyone can take: the ones put up for grabs that nobody has claimed,
  // minus your own - offering your own shift is not an invitation to yourself.
  const takeable = openShifts.filter(
    (o) => o.date >= today && o.originalMemberId !== memberId,
  );

  const blockedDays = conflicts.map((c) => DAYS[c.dayIndex]).filter(Boolean);

  const history: HistoryEntry[] = past.map((s) => {
    const noShow = s.status === 'no-show';
    const handedOff = s.role === 'assigned' && s.coveredByName !== null;
    const offered = s.status === 'flagged';
    return {
      assignmentId: s.assignmentId,
      label: `${weekday(s.date).slice(0, 3)} ${shortDate(s.date)}`,
      detail:
        (s.meal === 'lunch' ? 'Lunch' : 'Dinner') +
        (s.role === 'covering' ? ` · covered for ${s.coveringForName}` : '') +
        (handedOff ? ` · ${s.coveredByName} took it` : '') +
        (s.isMakeup ? ' · make-up' : ''),
      points: noShow || handedOff ? 0 : s.pointsAwarded || s.multiplier,
      outcome: noShow
        ? 'no-show'
        : handedOff
          ? 'handed-off'
          : offered
            ? 'offered'
            : 'served',
    };
  });

  return (
    <AppShell
      session={session}
      active="/"
      viewingAs={readOnly ? (member?.name ?? null) : null}
      title={
        readOnly
          ? (member?.name ?? 'Unknown brother')
          : `${greeting()}, ${session.name.split(' ')[0]}`
      }
      subtitle={`${weekday(today)}, ${dateLine(today)}`}
    >
      {/* ---------------- what you owe, if anything ---------------- */}
      {next ? (
        <div className={`next-shift${next.date === today ? ' is-today' : ''}`}>
          <div className="next-head">
            <span className="next-when">{whenPhrase(next.date, today)}</span>
            {next.multiplier > 1 && (
              <span className="wg-mult mono">{formatPoints(next.multiplier)}× points</span>
            )}
          </div>

          <div className="next-day">{weekday(next.date)}</div>
          <div className="next-date">
            {dateLine(next.date)} ·{' '}
            {next.meal === 'lunch' ? 'Lunch cleanup' : 'Dinner cleanup'}
            {next.isMakeup && <span className="wg-badge makeup">make-up</span>}
          </div>

          {next.role === 'covering' && (
            <div className="next-covering">
              You took this one for {next.coveringForName}. The point is yours
              when it is served.
            </div>
          )}

          <div className="next-crew">
            {next.crew.length > 0 ? `With ${next.crew.join(' and ')}` : 'On your own'}
          </div>

          {next.status === 'flagged' && (
            <div className="next-flagged">
              Up for grabs. Still yours until somebody takes it.
            </div>
          )}

          {next.coveredByName && (
            <div className="next-covered">
              {next.coveredByName} is covering this one for you.
            </div>
          )}

          {!readOnly && next.status === 'assigned' && next.role === 'assigned' && (
            <div className="next-action">
              <OfferShiftButton assignmentId={next.assignmentId} />
              <CalendarSyncButton feedToken={calendarFeedToken(memberId)} />
            </div>
          )}
        </div>
      ) : (
        <div className="next-shift none">
          <div className="next-when">Nothing on you</div>
          <div className="next-day">You are clear for now</div>
          <div className="next-crew">
            {member?.exempt
              ? 'You are exempt from the duty rotation.'
              : horizon.lastDate
                ? `Not on anything through ${shortDate(horizon.lastDate)}.`
                : 'No schedule posted yet.'}
          </div>
          <div className="next-action">
            <Link className="btn sm gold" href="/schedule">
              See the board →
            </Link>
          </div>
        </div>
      )}

      {/* ---------------- the numbers ---------------- */}
      <div className="my-shifts-stats-bar">
        <div className="stat-card">
          <span className="stat-val mono">{formatPoints(member?.points ?? 0)}</span>
          <span className="stat-lbl">Points</span>
        </div>
        <Link className="stat-card" href="/standings">
          <span className="stat-val mono">
            {standings.me ? standings.me.rank : '—'}
            {standings.me && (
              <span className="stat-val-sub">/{standings.me.total}</span>
            )}
          </span>
          <span className="stat-lbl">Standing</span>
        </Link>
        <div className="stat-card">
          <span className="stat-val mono">{upcoming.length}</span>
          <span className="stat-lbl">Upcoming</span>
        </div>
        {(member?.makeupDebt ?? 0) > 0 && (
          <div className="stat-card bad">
            <span className="stat-val mono">{member!.makeupDebt}</span>
            <span className="stat-lbl">Make-ups owed</span>
          </div>
        )}
      </div>

      {(member?.makeupDebt ?? 0) > 0 && (
        <div className="alert bad">
          <span className="alert-title">
            You owe {member!.makeupDebt} make-up shift
            {member!.makeupDebt === 1 ? '' : 's'}
          </span>
          <span className="alert-body">
            You missed a shift without anyone covering it. You will come up
            again sooner than normal until it is worked off.
          </span>
        </div>
      )}

      <HorizonNote horizon={horizon} today={today} />

      {/* ---------------- seats going spare ---------------- */}
      {takeable.length > 0 && (
        <Link className="home-row" href="/schedule">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" />
            <path d="M10.3 3.9 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <div className="home-row-text">
            <span className="home-row-title">
              {takeable.length} seat{takeable.length === 1 ? '' : 's'} going spare
            </span>
            <span className="home-row-sub">
              Take one and the point is yours, whatever your year.
            </span>
          </div>
          <span className="home-row-chev">→</span>
        </Link>
      )}

      {/* ---------------- availability, set once a semester ---------------- */}
      <Link className="home-row" href="/availability">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-400)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        <div className="home-row-text">
          <span className="home-row-title">Standing availability</span>
          <span className="home-row-sub">
            {blockedDays.length === 0
              ? 'No days blocked — you can be drawn any day the house serves.'
              : `${blockedDays.join(' and ')} blocked for the semester.`}
          </span>
        </div>
        <span className="home-row-chev">→</span>
      </Link>

      {/* ---------------- the rest of what is coming ---------------- */}
      {later.length > 0 && (
        <>
          <h2 className="section-title">
            Also coming up
            <span className="section-count mono">{later.length}</span>
          </h2>
          <div className="later-shifts-list">
            {later.map((s) => (
              <div key={s.assignmentId} className="upcoming-shift">
                <div className="up-top">
                  <span className="up-when">{whenPhrase(s.date, today)}</span>
                  {s.role === 'covering' && <span className="wg-badge makeup">covering</span>}
                  {s.isMakeup && <span className="wg-badge makeup">make-up</span>}
                  {s.status === 'flagged' && <span className="wg-badge bad">up for grabs</span>}
                  {s.multiplier > 1 && (
                    <span className="wg-mult mono">{formatPoints(s.multiplier)}×</span>
                  )}
                </div>
                <div className="up-main">
                  <div className="up-date">
                    <span className="up-day">{weekday(s.date)}</span>
                    <span className="up-full">{dateLine(s.date)}</span>
                  </div>
                  <span className={`up-meal ${s.meal}`}>
                    {s.meal === 'lunch' ? 'Lunch cleanup' : 'Dinner cleanup'}
                  </span>
                </div>
                <div className="up-crew">
                  {s.role === 'covering'
                    ? `Covering for ${s.coveringForName}`
                    : s.coveredByName
                      ? `${s.coveredByName} is covering`
                      : s.crew.length > 0
                        ? `With ${s.crew.join(' and ')}`
                        : 'On your own'}
                </div>
                {!readOnly && s.status === 'assigned' && s.role === 'assigned' && (
                  <div className="up-action">
                    <OfferShiftButton assignmentId={s.assignmentId} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------------- what you have done ---------------- */}
      <h2 className="section-title" style={{ marginTop: 32 }}>
        History
        <span className="section-count mono">{past.length}</span>
      </h2>
      <HistoryList entries={history} />

    </AppShell>
  );
}
