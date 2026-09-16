/**
 * Kitchen Manager - Late Plate Admin Dashboard & Tablet Monitor.
 *
 * Provides real-time queue management, status overrides, manual plate placement,
 * re-request unblocking, chef tablet usage monitoring, and semester request analytics.
 */

import { redirect } from 'next/navigation';
import { desc, eq, like, count, sql } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import { latePlates, members, events, semesters } from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { todayInEastern, parseISO, formatClock, parseClock } from '../../../../lib/dates.ts';
import {
  listLatePlates,
  getStandingCutoffs,
  SERVE_TIMES,
} from '../../../../lib/late-plate-service.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { AppShell } from '../../shell.tsx';
import { LatePlateAdminClient } from './late-plate-admin-client.tsx';
import { LatePlateMealGrid } from './late-plate-meal-grid.tsx';
import { LatePlateToggle } from './late-plate-toggle.tsx';
import { LatePlateSettingsForm } from './late-plate-settings-form.tsx';
import { DEFAULT_LATE_PLATE_DAYS, type MealDayConfig } from '../../../../lib/types.ts';

export const dynamic = 'force-dynamic';

function clock(hhmm: string): string {
  const m = parseClock(hhmm);
  return m === null ? hhmm : formatClock(m);
}

export default async function AdminLatePlatesPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/late-plate');

  const today = todayInEastern();

  const [
    todayPlates,
    activeRoster,
    standingCutoffs,
    recentEvents,
    stats,
    semester,
  ] = await Promise.all([
    listLatePlates(today, { includeClosed: true }),
    db
      .select({
        id: members.id,
        name: members.name,
        dietaryFlags: members.dietaryFlags,
        dietaryOther: members.dietaryOther,
      })
      .from(members)
      .where(eq(members.active, true))
      .orderBy(members.name),
    getStandingCutoffs(),
    db
      .select({
        id: events.id,
        action: events.action,
        actorName: events.actorName,
        summary: events.summary,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(like(events.action, 'late-plate%'))
      .orderBy(desc(events.createdAt))
      .limit(10),
    // Aggregate stats
    db
      .select({
        total: count(latePlates.id),
        readyCount: sql<number>`sum(case when ${latePlates.status} = 'ready' then 1 else 0 end)`,
        waitingCount: sql<number>`sum(case when ${latePlates.status} = 'waiting' then 1 else 0 end)`,
        declinedCount: sql<number>`sum(case when ${latePlates.status} = 'declined' then 1 else 0 end)`,
        cancelledCount: sql<number>`sum(case when ${latePlates.status} = 'cancelled' then 1 else 0 end)`,
      })
      .from(latePlates),
    getActiveSemester().catch(() => null),
  ]);

  const totalToday = todayPlates.length;
  const waitingToday = todayPlates.filter((p) => p.status === 'waiting').length;
  const readyToday = todayPlates.filter((p) => p.status === 'ready').length;
  const flaggedToday = todayPlates.filter((p) => p.flags.hasAny).length;

  const lunchToday = todayPlates.filter((p) => p.meal === 'lunch').length;
  const dinnerToday = todayPlates.filter((p) => p.meal === 'dinner').length;

  const hasTabletToken = Boolean(semester?.kioskToken || process.env.LATE_PLATE_DEVICE_TOKEN);
  const latePlatesEnabled = semester?.latePlatesEnabled ?? true;
  const latePlateDays = (semester?.latePlateDays ??
    DEFAULT_LATE_PLATE_DAYS) as MealDayConfig;

  // Last chef action
  const lastChefEvent = recentEvents.find((e) =>
    ['late-plate.ready', 'late-plate.declined', 'late-plate.cutoff_changed'].includes(
      e.action,
    ),
  );

  return (
    <AppShell
      session={session}
      active="/admin/late-plates"
      title="Late Plates Management"
      subtitle="Monitor live kitchen requests, tablet usage, status overrides, and house analytics"
    >
      {/* Compact Daily Summary Banner */}
      <div className="lp-admin-summary banner-info card" style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: '16px 32px', padding: 16 }}>
        <div>
          <div className="lp-eyebrow" style={{ color: 'var(--ink-400)' }}>Today's Requests</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalToday} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-400)' }}>({lunchToday} L · {dinnerToday} D)</span></div>
        </div>
        <div>
          <div className="lp-eyebrow" style={{ color: 'var(--ink-400)' }}>Waiting to Box</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: waitingToday > 0 ? 'var(--gold-400)' : 'inherit' }}>{waitingToday} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-400)' }}>({readyToday} Ready)</span></div>
        </div>
        <div>
          <div className="lp-eyebrow" style={{ color: 'var(--ink-400)' }}>Dietary Flags</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: flaggedToday > 0 ? '#f87171' : 'inherit' }}>{flaggedToday}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <div className="lp-eyebrow" style={{ color: 'var(--ink-400)' }}>Kitchen Tablet</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ color: hasTabletToken ? '#10b981' : '#f87171' }}>●</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{hasTabletToken ? 'Active' : 'Unset'}</span>
          </div>
        </div>
      </div>

      {/* Chef Tablet Monitor & Standing Cutoffs Info */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>
              Chef Tablet & Kitchen Activity
            </h2>
            <div style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 2 }}>
              Kiosk link: <code>/kitchen/late-plates?device={hasTabletToken ? '***' : 'UNCONFIGURED'}</code>
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
            Standing Cutoffs: Lunch <strong>{clock(standingCutoffs.lunch.cutoff)}</strong> · Dinner <strong>{clock(standingCutoffs.dinner.cutoff)}</strong>
          </div>
        </div>

        {lastChefEvent && (
          <div className="note" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🧑‍🍳</span>
            <span>
              <strong>Latest Kitchen Event:</strong> {lastChefEvent.summary} (
              {new Date(lastChefEvent.createdAt).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
              )
            </span>
          </div>
        )}
      </div>

      {/* Live Queue & Management Client */}
      <LatePlateAdminClient
        todayPlates={todayPlates}
        roster={activeRoster}
        today={today}
      />

      {/* ---- what used to be stranded over on Settings ---- */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Late plate settings
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 0 }}>
          These used to live on the Settings page, two clicks from the queue
          they govern. Cutoffs themselves are still the chefs&apos; to set on
          the kiosk &mdash; they run on 11:00 AM for lunch and 3:00 PM for
          dinner and leave them alone.
        </p>

        <h3 className="section-title" style={{ fontSize: 15 }}>
          Which days requests are open
        </h3>
        <LatePlateMealGrid initial={latePlateDays} />

        <hr style={{ margin: '22px 0', borderColor: 'var(--line-strong)' }} />

        <h3 className="section-title" style={{ fontSize: 15, marginTop: 0 }}>
          Requesting
        </h3>
        <LatePlateToggle initialEnabled={latePlatesEnabled} />

        <hr style={{ margin: '22px 0', borderColor: 'var(--line-strong)' }} />

        <LatePlateSettingsForm
          defaultMessage={semester?.latePlateMessage ?? null}
          defaultLogo={semester?.logoUrl ?? null}
        />
      </div>

      {/* Recent Event Audit Log */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Late Plate Audit Log
        </h2>
        <div style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 2 }}>
          Recent actions, status changes, cancellations, and unblocks.
        </div>

        <div className="lp-admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="lp-admin-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: 12, color: 'var(--ink-400)', whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td>
                    <code style={{ fontSize: 11.5 }}>{e.action}</code>
                  </td>
                  <td>{e.actorName ?? 'System / Chef'}</td>
                  <td style={{ fontSize: 12.5 }}>{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
