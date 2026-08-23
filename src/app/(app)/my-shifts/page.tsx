import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import { getMyShifts, getMemberById } from '../../../lib/member-queries.ts';
import { getScheduleHorizon } from '../../../lib/week-service.ts';
import { parseISO, daysBetween } from '../../../lib/dates.ts';
import { formatPoints } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { HorizonNote } from '../horizon-note.tsx';
import { FlagButton } from './flag-button.tsx';

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

  const today = new Date().toISOString().slice(0, 10);
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
      subtitle={`${session.name} · ${meal} duty`}
    >
      {/* The one question this screen exists to answer, answered first. */}
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
              You picked this up for {next.coveringForName}. You are the one who
              needs to show up, and the point is yours.
            </div>
          )}

          <div className="next-crew">
            {next.crew.length > 0
              ? `With ${next.crew.join(' and ')}`
              : 'You are on your own for this one'}
          </div>

          {next.status === 'flagged' && (
            <div className="next-flagged">
              You flagged this — it is open for anyone to pick up. Until
              somebody does, it is still yours.
            </div>
          )}

          {next.coveredByName && (
            <div className="next-covered">
              {next.coveredByName} is covering this for you.
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
          <div className="next-when">You are not scheduled</div>
          <div className="next-day">Nothing coming up</div>
          <div className="next-crew">
            {member?.exempt
              ? 'You are marked exempt, so you are not in the rotation. You can still pick up a shift any time.'
              : horizon.lastDate
                ? 'In the schedule posted so far. That only runs through the date below — you may still be assigned in a week that has not been posted yet.'
                : 'Nothing has been posted for this semester yet.'}
          </div>
          <div className="next-action">
            <Link className="btn sm" href="/schedule">
              See the full schedule
            </Link>
          </div>
        </div>
      )}

      {(member?.makeupDebt ?? 0) > 0 && (
        <div className="my-stats">
          <div className="my-stat owed">
            <span className="my-stat-value mono">{member!.makeupDebt}</span>
            <span className="my-stat-label">Make-ups owed</span>
          </div>
        </div>
      )}

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

      <HorizonNote horizon={horizon} today={today} />

      {later.length > 0 && (
        <>
          <h2 className="section-title">
            Your other shift{later.length === 1 ? '' : 's'}
            <span className="section-count mono">{later.length}</span>
          </h2>

          {/* Full cards rather than list rows. A later shift is still a shift
              you have to turn up to, and rendering it as a thin row made it
              read as a footnote to the first one. */}
          {later.map((s) => (
            <div key={s.assignmentId} className="upcoming-shift">
              <div className="up-top">
                <span className="up-when">{whenPhrase(s.date, today)}</span>
                {s.role === 'covering' && (
                  <span className="wg-badge makeup">covering</span>
                )}
                {s.isMakeup && <span className="wg-badge makeup">make-up</span>}
                {s.status === 'flagged' && (
                  <span className="wg-badge bad">flagged — open to the house</span>
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
                  ? `You picked this up for ${s.coveringForName}`
                  : s.coveredByName
                    ? `${s.coveredByName} is covering this for you`
                    : s.crew.length > 0
                      ? `With ${s.crew.join(' and ')}`
                      : 'You are on your own for this one'}
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
        </>
      )}

      <h2 className="section-title">
        Your shifts and points
        <span className="section-count mono">
          {formatPoints(member?.points ?? 0)} total
        </span>
      </h2>

      {shifts.length === 0 ? (
        <div className="card card-pad">
          <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
            Nothing yet. Points show up here as soon as you are scheduled.
          </span>
        </div>
      ) : (
        <div className="history">
          {[...shifts].reverse().map((s) => {
            const served = s.date < today;
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
                    {handedOff && ` · ${s.coveredByName} took it`}
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
                      <span className={`history-state${served ? ' done' : ' pending'}`}>
                        {served ? 'Served' : 'Pending'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="note">
        Points are credited as soon as you are put on the schedule — a shift
        that has not happened yet shows as <strong>Pending</strong>. If you do
        not show up, the point comes off and you move back toward the front of
        the queue.
      </div>

      <div className="alert info">
        <span className="alert-title">Have a class every week at that time?</span>
        <span className="alert-body">
          Set it once under <strong>Availability</strong> and you will never be
          scheduled then again — much easier than flagging the same shift every
          week.
        </span>
        <Link className="btn sm" href="/availability">
          Set my availability
        </Link>
      </div>
    </AppShell>
  );
}
