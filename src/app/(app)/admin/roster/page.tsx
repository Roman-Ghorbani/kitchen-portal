/**
 * Roster - everyone, and who can be drawn when.
 *
 * Absorbs the old /admin/stats page. Its stat tiles duplicated the dashboard's
 * (exempt and make-up counts appeared on three separate pages), so those moved
 * to the one row on the dashboard; what was actually worth keeping was the
 * day-by-day eligibility table and the app-readiness list, and both of those
 * belong beside the roster they are about.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq, gte } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import {
  members,
  standingConflicts,
  assignments as assignmentsTable,
  slots as slotsTable,
  weeks as weeksTable,
} from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { todayInEastern } from '../../../../lib/dates.ts';
import { AppShell } from '../../shell.tsx';
import { RosterTable, type RosterRow } from './roster-table.tsx';
import { EligibilityMatrix, type EligibilityDay } from './eligibility.tsx';
import {
  UnpreparedMembersSection,
  type MemberPreparedness,
} from './unprepared-members.tsx';

export const dynamic = 'force-dynamic';

const DAYS = [
  { index: 0, short: 'Mon', full: 'Monday' },
  { index: 1, short: 'Tue', full: 'Tuesday' },
  { index: 2, short: 'Wed', full: 'Wednesday' },
  { index: 3, short: 'Thu', full: 'Thursday' },
  { index: 4, short: 'Fri', full: 'Friday' },
  { index: 5, short: 'Sat', full: 'Saturday' },
  { index: 6, short: 'Sun', full: 'Sunday' },
];

type View = 'everyone' | 'days' | 'readiness';

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const params = await searchParams;
  const view: View =
    params.view === 'days' ? 'days' : params.view === 'readiness' ? 'readiness' : 'everyone';

  const semester = await getActiveSemester();
  const today = todayInEastern();

  const [rows, conflicts, upcoming] = await Promise.all([
    db.select().from(members).orderBy(asc(members.name)),
    db
      .select()
      .from(standingConflicts)
      .where(eq(standingConflicts.semesterId, semester.id)),
    db
      .select({ memberId: assignmentsTable.memberId })
      .from(assignmentsTable)
      .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
      .innerJoin(weeksTable, eq(slotsTable.weekId, weeksTable.id))
      .where(
        and(eq(weeksTable.semesterId, semester.id), gte(slotsTable.date, today)),
      ),
  ]);

  const conflictCount = new Map<string, number>();
  for (const c of conflicts) {
    conflictCount.set(c.memberId, (conflictCount.get(c.memberId) ?? 0) + 1);
  }

  const shiftCount = new Map<string, number>();
  for (const a of upcoming) {
    shiftCount.set(a.memberId, (shiftCount.get(a.memberId) ?? 0) + 1);
  }

  const data: RosterRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    classYear: r.classYear,
    points: r.points,
    makeupDebt: r.makeupDebt,
    exempt: r.exempt,
    exemptReason: r.exemptReason,
    exemptNotes: r.exemptNotes,
    hasPin: r.pinHash !== null,
    active: r.active,
    standingConflicts: conflictCount.get(r.id) ?? 0,
  }));

  const active = rows.filter((r) => r.active);
  const juniors = active.filter((m) => m.classYear === 'junior');
  const sophomores = active.filter((m) => m.classYear === 'sophomore');

  const readiness: MemberPreparedness[] = active.map((m) => ({
    id: m.id,
    name: m.name,
    classYear: m.classYear,
    exempt: m.exempt,
    hasPin: m.pinHash !== null,
    standingConflictsCount: conflictCount.get(m.id) ?? 0,
    isScheduled: (shiftCount.get(m.id) ?? 0) > 0,
    upcomingShiftsCount: shiftCount.get(m.id) ?? 0,
  }));

  const eligibility: EligibilityDay[] = DAYS.map((day) => {
    const blockedToday = new Map(
      conflicts.filter((c) => c.dayIndex === day.index).map((c) => [c.memberId, c.note]),
    );

    const pool = (people: typeof active) => {
      const blocked = people.filter((m) => m.exempt || blockedToday.has(m.id));
      return {
        total: people.length,
        available: people.length - blocked.length,
        blocked: blocked.map((m) => ({
          id: m.id,
          name: m.name,
          reason: m.exempt
            ? `Exempt · ${m.exemptReason ?? 'no reason given'}`
            : blockedToday.get(m.id) || 'Standing conflict',
        })),
      };
    };

    return { ...day, lunch: pool(juniors), dinner: pool(sophomores) };
  });

  const tab = (key: View, label: string, count?: number) => (
    <Link
      href={key === 'everyone' ? '/admin/roster' : `/admin/roster?view=${key}`}
      className={`adm-tab${view === key ? ' active' : ''}`}
    >
      {label}
      {count !== undefined && <span className="adm-tab-count mono">{count}</span>}
    </Link>
  );

  const notSignedIn = readiness.filter((m) => !m.hasPin && !m.exempt).length;

  return (
    <AppShell
      session={session}
      active="/admin/roster"
      title="Roster"
      subtitle={`${active.length} on duty · ${semester.name}`}
    >
      <div className="adm-tabs">
        {tab('everyone', 'Everyone', data.length)}
        {tab('days', 'Day by day')}
        {tab('readiness', 'Not ready', notSignedIn)}
      </div>

      {view === 'everyone' && (
        <>
          <RosterTable rows={data} />
          <div className="note">
            Tap anyone to change their duty year, adjust points, exempt them, or
            reset a forgotten PIN. Every change here is written to the audit log
            with your name on it. Points reset to zero each semester.
          </div>
        </>
      )}

      {view === 'days' && (
        <>
          <div className="note" style={{ marginTop: 0, marginBottom: 14 }}>
            Who the draw can reach on each day, once exemptions and standing
            conflicts are taken out. A thin bar is a day you will struggle to
            fill.
          </div>
          <EligibilityMatrix days={eligibility} />
        </>
      )}

      {view === 'readiness' && <UnpreparedMembersSection members={readiness} />}
    </AppShell>
  );
}
