import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import { getMyShifts, getMemberById } from '../../../lib/member-queries.ts';
import { getScheduleHorizon } from '../../../lib/week-service.ts';
import { parseISO, daysBetween, todayInEastern } from '../../../lib/dates.ts';
import { formatPoints } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { HorizonNote } from '../horizon-note.tsx';
import { FlagButton } from './flag-button.tsx';
import { CalendarSubscriptionCard } from './calendar-subscription.tsx';

export const dynamic = 'force-dynamic';

function pastDeadline(locksAt: Date | null): boolean {
  return locksAt !== null && new Date() > locksAt;
}

function weekday(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
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
  if (d < 7) return `In ${d} days`;
  return `In ${d} days`;
}

export default async function MyShiftsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role === 'admin') redirect('/admin');

  const [member, shifts, horizon] = await Promise.all([
    getMemberById(session.sub),
    getMyShifts(session.sub),
    getScheduleHorizon(),
  ]);

  const today = todayInEastern();
  const upcoming = shifts.filter((s) => s.date >= today);
  const past = shifts.filter((s) => s.date < today);
  const next = upcoming[0];
  const later = upcoming.slice(1);

  const meal = member?.classYear === 'junior' ? 'lunch' : 'dinner';

  return (
    <AppShell
      session={session}
      active="/my-shifts"
      title="My Shifts"
      subtitle={`${session.name} · ${meal === 'lunch' ? 'Lunch' : 'Dinner'} duty`}
    >
      <div className="my-shifts-stats-bar">
        <div className="stat-card">
          <span className="stat-val mono">{formatPoints(member?.points ?? 0)}</span>
          <span className="stat-lbl">Kitchen Points</span>
        </div>
        <div className="stat-card">
          <span className="stat-val">{upcoming.length}</span>
          <span className="stat-lbl">Upcoming Shifts</span>
        </div>
        {(member?.makeupDebt ?? 0) > 0 && (
          <div className="stat-card bad">
            <span className="stat-val mono">{member!.makeupDebt}</span>
            <span className="stat-lbl">Make-ups Owed</span>
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
            You missed a shift without flagging it. You will be scheduled again
            sooner than normal until it is worked off.
          </span>
        </div>
      )}

      <CalendarSubscriptionCard memberId={session.sub} />

      <div className="alert info" style={{ marginBottom: 20 }}>
        <span className="alert-title">💡 Missing a Specific Shift? No Google Form Needed!</span>
        <span className="alert-body">
          You don't need a Google Form to submit an excuse anymore! If you have a one-off conflict for an upcoming shift below, simply tap <strong>🚩 Flag Conflict</strong> on that shift card to state your reason and open it for coverage.
        </span>
      </div>

      {/* ---------------- Section 1: Upcoming Shifts ---------------- */}
      <h2 className="section-title">
        Upcoming Shifts
        <span className="section-count mono">{upcoming.length}</span>
      </h2>

      {next ? (
        <div className={`next-shift${next.date === today ? ' is-today' : ''}`}>
          <div className="next-when">{whenPhrase(next.date, today)}</div>
          <div className="next-day">{weekday(next.date)}</div>
          <div className="next-date">{dateLine(next.date)}</div>

          <div className="next-meal">
            {next.meal === 'lunch' ? 'Lunch cleanup' : 'Dinner cleanup'}
            {next.isMakeup && <span className="wg-badge makeup">make-up</span>}
            {next.multiplier > 1 && (
              <span className="wg-mult mono">{next.multiplier}× points</span>
            )}
          </div>

          {next.role === 'covering' && (
            <div className="next-covering">
              You picked this up for {next.coveringForName}. You earn the point when served.
            </div>
          )}

          <div className="next-crew">
            {next.crew.length > 0
              ? `With ${next.crew.join(' and ')}`
              : 'Single shift'}
          </div>

          {next.status === 'flagged' && (
            <div className="next-flagged">
              Conflict message submitted to Roman. Open for replacement.
            </div>
          )}

          {next.coveredByName && (
            <div className="next-covered">
              {next.coveredByName} is covering this shift for you.
            </div>
          )}

          {next.status === 'assigned' && next.role === 'assigned' && (
            <div className="next-action">
              <FlagButton
                assignmentId={next.assignmentId}
                disabled={
                  next.weekStatus !== 'posted' || pastDeadline(next.weekLocksAt)
                }
                disabledReason={
                  next.weekStatus !== 'posted'
                    ? 'Locked — contact Roman'
                    : 'Deadline passed'
                }
              />
            </div>
          )}
        </div>
      ) : (
        <div className="next-shift none">
          <div className="next-when">No upcoming shifts</div>
          <div className="next-day">You are clear for now</div>
          <div className="next-crew">
            {member?.exempt
              ? 'You are marked exempt from the regular duty rotation.'
              : horizon.lastDate
                ? `You are not scheduled on posted weeks through ${shortDate(horizon.lastDate)}.`
                : 'No schedule posted yet.'}
          </div>
          <div className="next-action">
            <Link className="btn sm gold" href="/schedule">
              Browse full house schedule →
            </Link>
          </div>
        </div>
      )}

      {later.length > 0 && (
        <div className="later-shifts-list">
          {later.map((s) => (
            <div key={s.assignmentId} className="upcoming-shift">
              <div className="up-top">
                <span className="up-when">{whenPhrase(s.date, today)}</span>
                {s.role === 'covering' && (
                  <span className="wg-badge makeup">covering</span>
                )}
                {s.isMakeup && <span className="wg-badge makeup">make-up</span>}
                {s.status === 'flagged' && (
                  <span className="wg-badge bad">flagged</span>
                )}
                {s.multiplier > 1 && (
                  <span className="wg-mult mono">{s.multiplier}× points</span>
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
                    ? `${s.coveredByName} covering`
                    : s.crew.length > 0
                      ? `With ${s.crew.join(' and ')}`
                      : 'Single shift'}
              </div>

              {s.status === 'assigned' && s.role === 'assigned' && (
                <div className="up-action">
                  <FlagButton
                    assignmentId={s.assignmentId}
                    disabled={
                      s.weekStatus !== 'posted' || pastDeadline(s.weekLocksAt)
                    }
                    disabledReason={
                      s.weekStatus !== 'posted'
                        ? 'Locked — contact Roman'
                        : 'Deadline passed'
                    }
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Section 2: Shift History & Points ---------------- */}
      <h2 className="section-title" style={{ marginTop: 36 }}>
        Shift History & Points Record
        <span className="section-count mono">{past.length} past</span>
      </h2>

      {past.length === 0 ? (
        <div className="card card-pad">
          <span style={{ fontSize: 13.5, color: 'var(--ink-400)' }}>
            No past shift history recorded yet. Completed shifts will appear here.
          </span>
        </div>
      ) : (
        <div className="history">
          {past.map((s) => {
            const noShow = s.status === 'no-show';
            const handedOff = s.role === 'assigned' && s.coveredByName !== null;
            const flagged = s.status === 'flagged';
            const earns = !noShow && !handedOff && !flagged;

            return (
              <div
                key={s.assignmentId}
                className={`history-row${noShow ? ' missed' : ''}`}
              >
                <div className="history-when">
                  <span className="history-date">
                    {weekday(s.date).slice(0, 3)} {dateLine(s.date)}
                  </span>
                  <span className="history-what">
                    {s.meal === 'lunch' ? 'Lunch' : 'Dinner'}
                    {s.role === 'covering' && ` · covering for ${s.coveringForName}`}
                    {handedOff && ` · ${s.coveredByName} covered`}
                    {s.isMakeup && ' · make-up'}
                    {s.multiplier > 1 && earns && ` · ${formatPoints(s.multiplier)}× bonus`}
                  </span>
                </div>

                <div className="history-right">
                  {noShow ? (
                    <>
                      <span className="history-points zero">0</span>
                      <span className="history-state bad">No-show</span>
                    </>
                  ) : handedOff ? (
                    <>
                      <span className="history-points zero">0</span>
                      <span className="history-state">Handed off</span>
                    </>
                  ) : flagged ? (
                    <>
                      <span className="history-points zero">0</span>
                      <span className="history-state">Flagged</span>
                    </>
                  ) : (
                    <>
                      <span className="history-points">
                        +{formatPoints(s.pointsAwarded || s.multiplier)}
                      </span>
                      <span className="history-state done">Served</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
