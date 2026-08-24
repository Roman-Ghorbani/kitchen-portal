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
import { mondayOf, addDays, parseISO, todayInEastern } from '../../../lib/dates.ts';
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
  if (session.role !== 'admin') redirect('/my-shifts');

  const [semester, roster, weekRows, recentEvents, horizon] = await Promise.all([
    getActiveSemester(),
    db.select().from(members).where(eq(members.active, true)),
    getLiveWeeks(),
    db.select().from(events).orderBy(desc(events.createdAt)).limit(8),
    getScheduleHorizon(),
  ]);

  const juniors = roster.filter((m) => m.classYear === 'junior');
  const sophomores = roster.filter((m) => m.classYear === 'sophomore');
  const exempt = roster.filter((m) => m.exempt);
  const withPin = roster.filter((m) => m.pinHash !== null);
  const owing = roster.filter((m) => m.makeupDebt > 0);

  const today = todayInEastern();
  const currentMonday = mondayOf(today);
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
      <div className="stat-grid">
        <div className="card card-pad stat-card">
          <div className="label">On duty</div>
          <div className="value mono">{roster.length}</div>
          <div className="foot">
            {juniors.length} juniors · {sophomores.length} sophomores
          </div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Signed up</div>
          <div className="value mono">
            {withPin.length}
            <span style={{ fontSize: 16, color: 'var(--ink-400)' }}>
              /{roster.length}
            </span>
          </div>
          <div className="foot">have set a PIN</div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Exempt</div>
          <div className="value mono">{exempt.length}</div>
          <div className="foot">excluded from rotation</div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Owe make-up</div>
          <div className="value mono">{owing.length}</div>
          <div className="foot">
            {owing.length === 0 ? 'nobody behind' : 'forced to front of queue'}
          </div>
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
            and it goes straight onto the board.
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
            const locked = w.status === 'locked' || w.status === 'complete';
            return (
              <div key={w.id} className="shift-row">
                <div className="shift-when">
                  <div className="shift-day">Week of {fmt(w.weekStart)}</div>
                  <div className="shift-crew">
                    {w.weekStart === currentMonday ? 'Running now' : 'Upcoming'}
                    {' · '}
                    {locked
                      ? 'locked, no changes from brothers'
                      : 'open for conflicts and pickups'}
                  </div>
                </div>
                <span className={`tag ${locked ? 'locked' : 'ok'}`}>
                  {locked ? 'Locked' : 'Open'}
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
                {e.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
              <span className="log-what">{e.summary}</span>
            </div>
          ))
        )}
      </div>
      <div className="note">
        Every consequential action is written here permanently — posted, viewed,
        flagged, covered, marked absent. This log is what answers a dispute.
      </div>
    </AppShell>
  );
}
