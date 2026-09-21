import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import { members, standingConflicts } from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { getLiveWeeks, getActiveSemester } from '../../../../lib/week-service.ts';
import { getWeekForManagement } from '../../../../lib/week-admin.ts';
import { parseISO, weekDates, todayInEastern, defaultScheduleMonday } from '../../../../lib/dates.ts';
import { AppShell } from '../../shell.tsx';
import { WeekControls } from './week-controls.tsx';
import { ManageDays } from './manage-client.tsx';
import { WeekNav } from './week-nav.tsx';
import type { Person, SlotView } from './week-controls.tsx';

export const dynamic = 'force-dynamic';

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function dayLabel(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function ManageWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const params = await searchParams;
  const allWeeks = await getLiveWeeks();

  if (allWeeks.length === 0) {
    return (
      <AppShell
        session={session}
        active="/admin/week"
        title="Manage week"
        subtitle="Nothing to manage yet"
      >
        <div className="alert warn">
          <span className="alert-title">No weeks exist yet</span>
          <span className="alert-body">
            Post the first week from the dashboard.
          </span>
          <Link className="btn sm" href="/admin">
            Go to dashboard
          </Link>
        </div>
      </AppShell>
    );
  }

  const currentMonday = defaultScheduleMonday();
  const visibleActive = allWeeks.filter((w) => w.weekStart >= currentMonday);
  const activeWeeks = visibleActive.length > 0 ? visibleActive : [allWeeks.at(-1)!];
  const archivedWeeks = allWeeks.filter((w) => w.weekStart < currentMonday);

  const defaultWeek =
    activeWeeks.find((w) => w.weekStart === currentMonday)?.weekStart ??
    activeWeeks[0]?.weekStart ??
    allWeeks.at(-1)!.weekStart;

  const selected = params.week ?? defaultWeek;
  const target = allWeeks.find((w) => w.weekStart === selected) ?? allWeeks.at(-1)!;

  const managed = await getWeekForManagement(target.id);
  if (!managed) redirect('/admin/week');

  const [semester, rosterRows] = await Promise.all([
    getActiveSemester(),
    db
      .select()
      .from(members)
      .where(eq(members.active, true))
      .orderBy(asc(members.name)),
  ]);

  const conflictRows = await db
    .select()
    .from(standingConflicts)
    .where(eq(standingConflicts.semesterId, semester.id));

  const conflictsByMember = new Map<string, number[]>();
  for (const c of conflictRows) {
    const list = conflictsByMember.get(c.memberId) ?? [];
    list.push(c.dayIndex);
    conflictsByMember.set(c.memberId, list);
  }

  const roster: Person[] = rosterRows.map((r) => ({
    id: r.id,
    name: r.name,
    classYear: r.classYear,
    points: r.points,
    exempt: r.exempt,
    makeupDebt: r.makeupDebt,
    lastServedDate: r.lastServedDate,
    standingConflicts: conflictsByMember.get(r.id) ?? [],
  }));

  const today = todayInEastern();
  const hasStarted = managed.week.weekStart <= today;

  const lastDay = managed.slots.map((s) => s.date).sort().at(-1);
  const weekLabel = lastDay
    ? `${shortDate(managed.week.weekStart)} – ${shortDate(lastDay)}`
    : `Week of ${shortDate(managed.week.weekStart)}`;

  const unresolved =
    managed.slots.reduce(
      (n, s) =>
        n +
        s.assignments.filter((a) => a.status === 'flagged').length +
        (s.size - s.assignments.length),
      0,
    ) ?? 0;

  const dates = weekDates(managed.week.weekStart);
  // Attendance controls only appear once a day has actually happened.
  const days = dates.map((date) => ({
    date,
    label: dayLabel(date),
    isPast: date <= today,
    slots: managed.slots.filter((s) => s.date === date) as SlotView[],
  }));

  const isArchived = target.weekStart < currentMonday || target.status === 'complete';

  return (
    <AppShell
      session={session}
      active="/admin/week"
      title="Manage week"
      subtitle={`Week of ${shortDate(managed.week.weekStart)}`}
    >
      <WeekNav
        activeWeeks={activeWeeks}
        archivedWeeks={archivedWeeks}
        currentMonday={currentMonday}
        selected={selected}
      />

      {target.weekStart < currentMonday && (
        <div className="alert info archive-banner" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              width: '100%',
            }}
          >
            <div>
              <span className="alert-title">📁 Viewing Archived Past Week</span>
              <span className="alert-body">
                This week concluded on {shortDate(lastDay ?? managed.week.weekStart)}. Shift history and attendance records are archived.
              </span>
            </div>
            <Link className="btn sm gold" href="/admin/week">
              ← Return to current week
            </Link>
          </div>
        </div>
      )}

      <WeekControls
        weekId={managed.week.id}
        weekStart={managed.week.weekStart}
        weekLabel={weekLabel}
        status={managed.week.status}
        hasStarted={hasStarted}
        unresolved={unresolved}
        isArchived={isArchived}
      />

      <h2 className="section-title">Shifts</h2>

      <ManageDays weekId={managed.week.id} days={days} roster={roster} />
    </AppShell>
  );
}
