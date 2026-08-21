import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, desc } from 'drizzle-orm';

import { db } from '../../../db/index.ts';
import { members, events } from '../../../db/schema.ts';
import { getSession } from '../../../lib/session.ts';
import { getLiveWeeks, getActiveSemester } from '../../../lib/week-service.ts';
import { mondayOf, addDays, parseISO } from '../../../lib/dates.ts';
import { AppShell } from '../shell.tsx';
import { PostWeekButton } from './post-week-button.tsx';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/my-shifts');

  const [semester, roster, weekRows, recentEvents] = await Promise.all([
    getActiveSemester(),
    db.select().from(members).where(eq(members.active, true)),
    getLiveWeeks(),
    db.select().from(events).orderBy(desc(events.createdAt)).limit(8),
  ]);

  const juniors = roster.filter((m) => m.classYear === 'junior');
  const sophomores = roster.filter((m) => m.classYear === 'sophomore');
  const exempt = roster.filter((m) => m.exempt);
  const withPin = roster.filter((m) => m.pinHash !== null);
  const owing = roster.filter((m) => m.makeupDebt > 0);

  const today = new Date().toISOString().slice(0, 10);
  const currentMonday = mondayOf(today);
  const posted = weekRows.map((w) => w.weekStart);

  // The first week of the semester, then the normal 8-days-ahead cadence.
  const nextToPost =
    posted.length === 0
      ? mondayOf(semester.startsOn)
      : addDays(posted.slice().sort().at(-1)!, 7);
  const isBootstrap = posted.length === 0;

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

      <h2 className="section-title">Weeks</h2>

      {weekRows.length === 0 ? (
        <div className="card card-pad">
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            No week posted yet — the house cannot see anything.
          </div>
          <div className="note">
            {semester.name} starts {fmt(semester.startsOn)}. Posting the first
            week is a one-time exception: the normal rule gives a week a full
            7-day window between posting and going live, but the semester begins
            right after the first chapter, so week one gets a shortened window.
            Say so when you announce it.
          </div>
          <div className="row-actions">
            <PostWeekButton
              weekStart={nextToPost}
              isBootstrap
              label={`Generate and post week of ${fmt(nextToPost)}`}
            />
          </div>
        </div>
      ) : (
        <>
          {weekRows.map((w) => (
            <div key={w.id} className="shift-row">
              <div className="shift-when">
                <div className="shift-day">Week of {fmt(w.weekStart)}</div>
                <div className="shift-crew">
                  {w.weekStart === currentMonday
                    ? 'Running now'
                    : w.weekStart > currentMonday
                      ? 'Upcoming'
                      : 'Past'}
                  {w.isBootstrap && ' · bootstrap week'}
                </div>
              </div>
              <span className={`tag ${w.status === 'posted' ? 'ok' : 'locked'}`}>
                {w.status}
              </span>
              <Link className="btn sm" href={`/schedule?week=${w.weekStart}`}>
                View
              </Link>
            </div>
          ))}

          <div className="row-actions">
            <PostWeekButton
              weekStart={nextToPost}
              isBootstrap={isBootstrap}
              label={`Generate and post week of ${fmt(nextToPost)}`}
            />
          </div>
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
