import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';

import { db } from '../../../db/index.ts';
import { members, events } from '../../../db/schema.ts';
import { getSession } from '../../../lib/session.ts';
import {
  getLiveWeeks,
  getActiveSemester,
  getScheduleHorizon,
} from '../../../lib/week-service.ts';
import { getOpenShifts } from '../../../lib/shift-service.ts';
import { formatPoints } from '../../../lib/types.ts';
import { mondayOf, addDays, parseISO, todayInEastern, formatEasternTimestamp, defaultScheduleMonday } from '../../../lib/dates.ts';
import { AppShell } from '../shell.tsx';
import { CreateWeekButton } from './create-week.tsx';
import { HorizonNote } from '../horizon-note.tsx';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

import { CopyAnnouncementButton } from './copy-announcement.tsx';

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const [semester, roster, weekRows, recentEvents, horizon, openShifts] =
    await Promise.all([
      getActiveSemester(),
      db.select().from(members).where(eq(members.active, true)),
      getLiveWeeks(),
      db.select().from(events).orderBy(desc(events.createdAt)).limit(8),
      getScheduleHorizon(),
      getOpenShifts(),
    ]);

  const lunchCrew = roster.filter((m) => !m.exempt && m.rotation === 'lunch');
  const dinnerCrew = roster.filter((m) => !m.exempt && m.rotation === 'dinner');
  const exempt = roster.filter((m) => m.exempt);
  const withPin = roster.filter((m) => m.pinHash !== null);
  const owing = roster.filter((m) => m.makeupDebt > 0);

  // These two used to live on their own pages. The point spread was the whole
  // reason to open the roster, and the open-seat count was buried in the board.
  const eligiblePoints = roster.filter((m) => !m.exempt).map((m) => m.points);
  const spread =
    eligiblePoints.length > 0
      ? Math.max(...eligiblePoints) - Math.min(...eligiblePoints)
      : 0;
  const signedInPct =
    roster.length > 0 ? Math.round((withPin.length / roster.length) * 100) : 0;
  const unclaimed = openShifts.filter((o) => o.date >= todayInEastern()).length;

  const today = todayInEastern();
  const currentMonday = defaultScheduleMonday();
  const posted = weekRows.map((w) => w.weekStart);

  const activeWeeks = weekRows.filter((w) => w.weekStart >= currentMonday);
  const pastWeeks = weekRows.filter((w) => w.weekStart < currentMonday);

  // Simply the week after the last one that exists.
  const nextToPost =
    posted.length === 0
      ? mondayOf(semester.startsOn)
      : addDays(posted.slice().sort().at(-1)!, 7);

  return (
    <AppShell
      session={session}
      active="/admin"
      title="Dashboard"
      subtitle={`${semester.name} · ${semester.startsOn} to ${semester.endsOn}`}
    >
      {/* One row, not three. These six tiles used to be spread across the
          dashboard, the roster and the stats page, with exempt and make-up
          counts repeated on all three. */}
      <div className="stat-grid six">
        <Link className="card card-pad stat-card" href="/admin/roster">
          <div className="label">On duty</div>
          <div className="value mono">{lunchCrew.length + dinnerCrew.length}</div>
          <div className="foot">
            {lunchCrew.length} lunch rotation · {dinnerCrew.length} dinner rotation
          </div>
        </Link>
        <Link className="card card-pad stat-card" href="/admin/roster?view=readiness">
          <div className="label">Signed in</div>
          <div className="value mono">
            {signedInPct}
            <span className="stat-val-sub">%</span>
          </div>
          <div className="foot">{withPin.length} have set a PIN</div>
        </Link>
        <div className="card card-pad stat-card">
          <div className="label">Point spread</div>
          <div className="value mono">{formatPoints(spread)}</div>
          <div className="foot">
            {spread <= 1 ? 'even — nobody behind' : 'most to least served'}
          </div>
        </div>
        <Link
          className={`card card-pad stat-card${unclaimed > 0 ? ' warn' : ''}`}
          href="/schedule"
        >
          <div className="label">Up for grabs</div>
          <div className="value mono">{unclaimed}</div>
          <div className="foot">
            {unclaimed === 0 ? 'nothing outstanding' : 'nobody has taken them'}
          </div>
        </Link>
        <Link
          className={`card card-pad stat-card${owing.length > 0 ? ' bad' : ''}`}
          href="/admin/roster"
        >
          <div className="label">Owe make-up</div>
          <div className="value mono">{owing.length}</div>
          <div className="foot">
            {owing.length === 0 ? 'nobody behind' : 'forced to front of queue'}
          </div>
        </Link>
        <div className="card card-pad stat-card">
          <div className="label">Exempt</div>
          <div className="value mono">{exempt.length}</div>
          <div className="foot">out of the rotation</div>
        </div>
      </div>

      <h2 className="section-title">Schedule Weeks</h2>

      <HorizonNote horizon={horizon} today={today} />

      {weekRows.length === 0 ? (
        <div className="card card-pad">
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            No week exists yet — the house sees nothing.
          </div>
          <div className="note">
            {semester.name} starts {fmt(semester.startsOn)}. Draw the first week
            and it goes straight onto the board. New to this, or a new semester?
            Follow the <Link href="/admin/guide#semester">start-of-semester
            checklist</Link> first.
          </div>
          <div className="row-actions">
            <CreateWeekButton
              suggested={nextToPost}
              suggestedLabel={fmt(nextToPost)}
              existing={posted}
            />
          </div>
        </div>
      ) : (
        <>
          {activeWeeks.map((w) => {
            const finished = w.status === 'complete';
            return (
              <div key={w.id} className="shift-row">
                <div className="shift-when">
                  <div className="shift-day">Week of {fmt(w.weekStart)}</div>
                  <div className="shift-crew">
                    {w.weekStart === currentMonday ? 'Running now' : 'Upcoming'}
                    {' · '}
                    {finished
                      ? 'finished'
                      : 'anyone can put a shift up for grabs, or take one'}
                  </div>
                </div>
                <span className={`tag ${finished ? 'locked' : 'ok'}`}>
                  {finished ? 'Finished' : 'Posted'}
                </span>
                <Link className="btn sm" href={`/admin/week?week=${w.weekStart}`}>
                  Manage
                </Link>
              </div>
            );
          })}

          <div className="row-actions" style={{ marginTop: 16 }}>
            <CreateWeekButton
              suggested={nextToPost}
              suggestedLabel={fmt(nextToPost)}
              existing={posted}
            />
            {posted.length > 0 && (
              <CopyAnnouncementButton weekStart={fmt(posted.at(-1)!)} />
            )}
          </div>

          {pastWeeks.length > 0 && (
            <details className="past-weeks-archive" style={{ marginTop: 24 }}>
              <summary className="archive-summary">
                📁 Past Weeks Archive ({pastWeeks.length} finished week{pastWeeks.length === 1 ? '' : 's'})
              </summary>
              <div className="archive-list" style={{ marginTop: 12 }}>
                {pastWeeks.map((w) => (
                  <div key={w.id} className="shift-row past" style={{ opacity: 0.8 }}>
                    <div className="shift-when">
                      <div className="shift-day">Week of {fmt(w.weekStart)}</div>
                      <div className="shift-crew">Finished · Archived record</div>
                    </div>
                    <span className="tag locked">Archived</span>
                    <Link className="btn sm" href={`/admin/week?week=${w.weekStart}`}>
                      View
                    </Link>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <h2 className="section-title">Recent activity</h2>
      <div className="card card-pad">
        {recentEvents.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-400)' }}>
            Nothing logged yet.
          </div>
        ) : (
          recentEvents.map((e) => (
            <div key={e.id} className="log-row">
              <span className="log-when mono">
                {formatEasternTimestamp(e.createdAt)}
              </span>
              <span className="log-what">{e.summary}</span>
            </div>
          ))
        )}
      </div>
      <div className="note">
        Every consequential action is written here permanently — posted, viewed,
        flagged, covered, marked absent. This log is what answers a dispute.
        How to run the kitchen week to week is in the{' '}
        <Link href="/admin/guide">Handbook</Link>.
      </div>
    </AppShell>
  );
}
