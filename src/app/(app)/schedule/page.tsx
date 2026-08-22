import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import {
  getWeek,
  getLiveWeeks,
  getScheduleHorizon,
  type DisplayWeek,
} from '../../../lib/week-service.ts';
import { AppShell } from '../shell.tsx';
import { WeekGrid } from './week-grid.tsx';
import { CopyWeekButton } from './copy-week.tsx';
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

/** Plain text version, shaped like the list the house is used to seeing. */
function weekAsText(week: DisplayWeek): string {
  const lines: string[] = [
    `KITCHEN DUTY — week of ${shortDate(week.weekStart)}`,
    '',
  ];

  for (const day of week.days) {
    const label = parseISO(day.date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    lines.push(label.toUpperCase());

    for (const [name, slot] of [
      ['Lunch', day.lunch],
      ['Dinner', day.dinner],
    ] as const) {
      if (!slot) continue;
      const who = slot.assignments
        .map((a) => {
          const served = a.coveredByName ?? a.memberName;
          if (a.status === 'flagged') return `${a.memberName} (NEEDS COVER)`;
          if (a.coveredByName) return `${served} (covering ${a.memberName})`;
          return served;
        })
        .join(', ');

      const short = slot.size - slot.assignments.length;
      lines.push(
        `  ${name}: ${who || '—'}${short > 0 ? ` (+${short} unfilled)` : ''}`,
      );
    }
    lines.push('');
  }

  lines.push('Flag conflicts in the app before Sunday chapter.');
  return lines.join('\n');
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // Deliberately viewable signed out. Looking at the schedule should be as
  // frictionless as the screenshot it replaces; a PIN is only needed to
  // change something.
  const session = await getSession();

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
        title="Kitchen Duty"
        subtitle="Nothing posted yet"
      >
        <div className="alert warn">
          <span className="alert-title">No schedule posted yet</span>
          <span className="alert-body">
            {session?.role === 'admin'
              ? 'Generate and post the first week from the dashboard.'
              : 'Check back after Sunday chapter.'}
          </span>
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
  const meId = session?.role === 'brother' ? session.sub : '';
  const canCover = session?.role === 'brother' && !isLocked;

  const lastDay = week.days.at(-1)?.date;
  const openCount = week.days.reduce(
    (n, d) =>
      n +
      [d.lunch, d.dinner].reduce(
        (m, s) =>
          m +
          (s
            ? s.assignments.filter((a) => a.status === 'flagged').length +
              (s.size - s.assignments.length)
            : 0),
        0,
      ),
    0,
  );

  return (
    <AppShell
      session={session}
      active="/schedule"
      title="Kitchen Duty"
      subtitle={
        lastDay
          ? `${shortDate(week.weekStart)} – ${shortDate(lastDay)} · ${week.days.length} service days`
          : `Week of ${shortDate(week.weekStart)}`
      }
    >
      {!session && (
        <div className="alert info">
          <span className="alert-title">You are viewing as a guest</span>
          <span className="alert-body">
            Anyone can see the schedule. Sign in to see your own shifts
            highlighted, flag a conflict, or pick one up.
          </span>
          <Link className="btn gold sm" href="/signin">
            Sign in
          </Link>
        </div>
      )}

      <HorizonNote horizon={horizon} today={today} />

      {openCount > 0 && (
        <div className="alert bad">
          <span className="alert-title">
            {openCount} shift{openCount === 1 ? '' : 's'} still need cover
          </span>
          <span className="alert-body">
            Anyone can take these and keep the point — look for the red
            &ldquo;needs cover&rdquo; markers below.
          </span>
        </div>
      )}

      <div className="week-bar">
        {allWeeks.length > 1 && (
          <div className="week-toggle">
            {allWeeks.map((w) => (
              <Link
                key={w.id}
                href={`/schedule?week=${w.weekStart}`}
                className={w.weekStart === selected ? 'active' : ''}
              >
                {w.weekStart === currentMonday
                  ? 'This week'
                  : w.weekStart === addDays(currentMonday, 7)
                    ? 'Next week'
                    : shortDate(w.weekStart)}
              </Link>
            ))}
          </div>
        )}

        <div className="week-bar-right">
          <span className={`tag ${week.status === 'posted' ? 'ok' : 'locked'}`}>
            {week.status === 'posted' ? 'Open for conflicts' : 'Locked'}
          </span>
          {/* Admin only: the group-chat post should come from Roman, not
              from whoever happens to open the page. */}
          {session?.role === 'admin' && (
            <CopyWeekButton text={weekAsText(week)} />
          )}
        </div>
      </div>

      {isLocked && (
        <div className="alert warn">
          <span className="alert-title">This week is locked</span>
          <span className="alert-body">
            Conflict flags closed at chapter. For a real emergency, contact
            Roman directly — do not just skip.
          </span>
        </div>
      )}

      <WeekGrid week={week} meId={meId} canCover={canCover} today={today} />

      <div className="wg-legend">
        {session?.role === 'brother' && (
          <span>
            <span className="legend-swatch me" /> You
          </span>
        )}
        <span>
          <span className="legend-swatch open" /> Needs cover
        </span>
        <span>Lunch is juniors · dinner is sophomores</span>
      </div>
    </AppShell>
  );
}
