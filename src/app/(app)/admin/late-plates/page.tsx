/**
 * Late plates, from the manager's side.
 *
 * Top to bottom, in the order he needs them:
 *   1. Today at a glance
 *   2. The kitchen tablet - is it online, pair or revoke one, and open the
 *      exact screen the chefs see
 *   3. Today's queue with his overrides and "place a plate for someone"
 *   4. Settings: which days are open, pausing requests, the house banner, and
 *      the cutoffs the chefs have set
 *   5. The latest kitchen activity, with a link into the full audit log
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, or, like } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import { members, events } from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { todayInEastern, formatClock, parseClock } from '../../../../lib/dates.ts';
import { listLatePlates, getStandingCutoffs } from '../../../../lib/late-plate-service.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { listDevices, legacyTokenActive } from '../../../../lib/kiosk.ts';
import { DEFAULT_LATE_PLATE_DAYS, type MealDayConfig } from '../../../../lib/types.ts';
import { AppShell } from '../../shell.tsx';
import { LatePlateAdminClient } from './late-plate-admin-client.tsx';
import { LatePlateMealGrid } from './late-plate-meal-grid.tsx';
import { LatePlateToggle } from './late-plate-toggle.tsx';
import { LatePlateSettingsForm } from './late-plate-settings-form.tsx';
import { KitchenTablets } from './kitchen-tablets.tsx';

export const dynamic = 'force-dynamic';

function clock(hhmm: string): string {
  const m = parseClock(hhmm);
  return m === null ? hhmm : formatClock(m);
}

const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export default async function AdminLatePlatesPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/late-plate');

  const today = todayInEastern();

  const [todayPlates, roster, standing, recent, semester, tablets, legacyLink] = await Promise.all([
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
        summary: events.summary,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(or(like(events.action, 'late-plate.%'), like(events.action, 'kiosk.%')))
      .orderBy(desc(events.createdAt))
      .limit(6),
    getActiveSemester(),
    listDevices(),
    legacyTokenActive(),
  ]);

  const count = (pred: (p: (typeof todayPlates)[number]) => boolean) =>
    todayPlates.filter(pred).length;
  const live = todayPlates.filter((p) => p.status !== 'cancelled');

  return (
    <AppShell session={session} active="/admin/late-plates" title="Late plates" subtitle="Today's queue, the kitchen tablet, and how requests work">
      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-label">Requests today</span>
          <span className="stat-value">{live.length}</span>
          <span className="stat-sub">
            {count((p) => p.meal === 'lunch' && p.status !== 'cancelled')} lunch ·{' '}
            {count((p) => p.meal === 'dinner' && p.status !== 'cancelled')} dinner
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Still to make</span>
          <span className="stat-value">{count((p) => p.status === 'waiting')}</span>
          <span className="stat-sub">{count((p) => p.status === 'ready')} ready on the shelf</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">With dietary flags</span>
          <span className="stat-value">{live.filter((p) => p.flags.hasAny).length}</span>
          <span className="stat-sub">chefs must acknowledge these</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Cutoffs</span>
          <span className="stat-value stat-value-sm">
            {clock(standing.lunch.cutoff)} · {clock(standing.dinner.cutoff)}
          </span>
          <span className="stat-sub">lunch · dinner, set by the chefs</span>
        </div>
      </div>

      <KitchenTablets
        tablets={tablets.map((t) => ({
          id: t.id,
          label: t.label,
          pairedAt: t.pairedAt?.toISOString() ?? null,
          lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
          pairingExpiresAt: t.pairingExpiresAt?.toISOString() ?? null,
        }))}
        legacyLinkActive={legacyLink}
      />

      <LatePlateAdminClient todayPlates={todayPlates} roster={roster} today={today} />

      <section className="card card-pad settings-card">
        <h2 className="section-title">How requests work</h2>

        <h3 className="subsection-title">Which days requests are open</h3>
        <LatePlateMealGrid initial={(semester.latePlateDays ?? DEFAULT_LATE_PLATE_DAYS) as MealDayConfig} />

        <h3 className="subsection-title">Requesting</h3>
        <LatePlateToggle initialEnabled={semester.latePlatesEnabled} />

        <h3 className="subsection-title">Banner</h3>
        <LatePlateSettingsForm defaultMessage={semester.latePlateMessage ?? null} />

        <p className="settings-hint">
          Cutoffs are the chefs&apos; to set from the tablet. They currently run
          at {clock(standing.lunch.cutoff)} for lunch and {clock(standing.dinner.cutoff)} for
          dinner.
        </p>
      </section>

      <section className="card card-pad settings-card">
        <div className="card-head-row">
          <h2 className="section-title">Recent kitchen activity</h2>
          <Link className="btn sm" href="/admin/audit?categories=late-plate,kiosk">
            Full history →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="settings-hint">Nothing yet.</p>
        ) : (
          <ul className="activity-list">
            {recent.map((e) => (
              <li key={e.id}>
                <time className="mono">{timeFmt.format(e.createdAt)}</time>
                <span>{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
