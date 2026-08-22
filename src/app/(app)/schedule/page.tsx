import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import {
  getWeek,
  getLiveWeeks,
  getScheduleHorizon,
} from '../../../lib/week-service.ts';
import { AppShell } from '../shell.tsx';
import { WeekGrid } from './week-grid.tsx';
import { HorizonNote } from '../horizon-note.tsx';
import { parseISO, mondayOf, addDays } from '../../../lib/dates.ts';

export const dynamic = 'force-dynamic';

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');

  const params = await searchParams;
  const [allWeeks, horizon] = await Promise.all([
    getLiveWeeks(),
    getScheduleHorizon(),
  ]);

  if (allWeeks.length === 0) {
    return (
      <AppShell
        session={session}
        active="/schedule"
        title="Schedule"
        subtitle="Nothing posted yet"
      >
        <div className="card card-pad">
          <h2 className="section-title" style={{ marginTop: 0 }}>
            No schedule yet
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink-400)' }}>
            {session.role === 'admin'
              ? 'Generate and post the first week from the dashboard.'
              : 'Roman has not posted a schedule yet. Check back after chapter.'}
          </p>
        </div>
      </AppShell>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const currentMonday = mondayOf(today);

  const defaultWeek =
    allWeeks.find((w) => w.weekStart === currentMonday)?.weekStart ??
    allWeeks.find((w) => w.weekStart >= currentMonday)?.weekStart ??
    allWeeks.at(-1)!.weekStart;

  const selected = params.week ?? defaultWeek;
  const week = await getWeek(selected);
  if (!week) redirect('/schedule');

  const isLocked = week.status === 'locked' || week.status === 'complete';
  const meId = session.role === 'brother' ? session.sub : '';
  const canCover = session.role === 'brother' && !isLocked;

  const lastDay = week.days.at(-1)?.date;

  return (
    <AppShell
      session={session}
      active="/schedule"
      title="Full Schedule"
      subtitle={
        lastDay
          ? `${shortDate(week.weekStart)} – ${shortDate(lastDay)} · ${week.days.length} service days`
          : `Week of ${shortDate(week.weekStart)}`
      }
    >
      <HorizonNote horizon={horizon} today={today} />

      {allWeeks.length > 1 && (
        <div className="week-toggle">
          {allWeeks.map((w) => (
            <Link
              key={w.id}
              href={`/schedule?week=${w.weekStart}`}
              className={w.weekStart === selected ? 'active' : ''}
            >
              {w.weekStart === currentMonday
                ? 'This Week'
                : w.weekStart === addDays(currentMonday, 7)
                  ? 'Next Week'
                  : shortDate(w.weekStart)}
              <span className={`tag ${w.status === 'posted' ? 'ok' : 'locked'}`}>
                {w.status}
              </span>
            </Link>
          ))}
        </div>
      )}

      {isLocked && (
        <div className="note">
          This week is locked — conflict flags closed at chapter. For a genuine
          emergency, contact Roman directly.
        </div>
      )}

      <WeekGrid week={week} meId={meId} canCover={canCover} today={today} />

      <div className="wg-legend">
        <span>
          <span className="legend-swatch me" /> You
        </span>
        <span>
          <span className="legend-swatch open" /> Needs cover
        </span>
        <span>Lunch is juniors · dinner is sophomores</span>
        <span>Nobody serves twice in a week unless they owe a make-up</span>
      </div>
    </AppShell>
  );
}
