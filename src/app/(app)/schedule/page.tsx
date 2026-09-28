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
import { parseISO, mondayOf, addDays, todayInEastern, defaultScheduleMonday } from '../../../lib/dates.ts';
import { getMemberDossier } from '../../../lib/member-dossier.ts';

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
  // Signed-in only. The board names who will be in the kitchen when, and the
  // app sits on a public hostname; sign-in lasts a year, so this costs a
  // brother one PIN entry, not friction every visit.
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
        title="The board"
        subtitle="Nothing posted yet"
      >
        <div className="alert warn">
          <span className="alert-title">No schedule posted yet</span>
          <span className="alert-body">
            {session?.role === 'admin'
              ? 'Draw and post the first week from the dashboard.'
              : 'Check back after Sunday chapter.'}
          </span>
        </div>
      </AppShell>
    );
  }

  const today = todayInEastern();
  const currentMonday = defaultScheduleMonday();

  // Only show this week and forward — hide past weeks
  const visibleWeeks = allWeeks.filter((w) => w.weekStart >= currentMonday);
  const activeWeeks = visibleWeeks.length > 0 ? visibleWeeks : allWeeks;

  if (params.week && params.week < currentMonday) {
    redirect('/schedule');
  }

  const defaultWeek =
    activeWeeks.find((w) => w.weekStart === currentMonday)?.weekStart ??
    activeWeeks[0]?.weekStart;

  const selected = params.week ?? defaultWeek;
  const week = await getWeek(selected);
  if (!week) redirect('/schedule');

  const meId = session ? session.sub : '';
  const canCover = Boolean(session) && week.status !== 'complete';

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

  const dossier = meId ? await getMemberDossier(meId) : null;
  const myMemberInfo = dossier
    ? {
        isExempt: dossier.member.exempt,
        standingConflicts: dossier.conflicts.map((c) => c.dayIndex),
      }
    : null;
  const myNextShift = dossier?.shifts.find((s) => s.date >= today && s.status !== 'covered');

  return (
    <AppShell
      session={session}
      active="/schedule"
      title="The board"
      subtitle={
        lastDay
          ? `${shortDate(week.weekStart)} – ${shortDate(lastDay)}`
          : `Week of ${shortDate(week.weekStart)}`
      }
    >

      <HorizonNote horizon={horizon} today={today} />

      {openCount > 0 && (
        <div className="alert bad">
          <span className="alert-title">
            {openCount} shift{openCount === 1 ? '' : 's'} still need cover
          </span>
          <span className="alert-body">
            Anyone can take these and keep the point, whatever their year.
          </span>
        </div>
      )}

      <div className="week-bar">
        {activeWeeks.length > 1 && (
          <div className="week-toggle">
            {activeWeeks.map((w) => (
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
          <span className={`tag ${week.status === 'complete' ? 'locked' : 'ok'}`}>
            {week.status === 'complete' ? 'Finished' : 'Posted'}
          </span>
          {/* Admin only: the group-chat post should come from the manager, not
              from whoever happens to open the page. */}
          {session?.role === 'admin' && (
            <CopyWeekButton text={weekAsText(week)} />
          )}
        </div>
      </div>


      <div id="week-grid">
        <WeekGrid
          week={week}
          meId={meId}
          canCover={canCover}
          isAdmin={session?.role === 'admin'}
          today={today}
          myMemberInfo={myMemberInfo}
        />
      </div>

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
