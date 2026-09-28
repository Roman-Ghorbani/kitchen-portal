/**
 * Roster - everyone, and who can be drawn when.
 *
 *   Everyone     the list: filter, select, and act on one person or many
 *   Day by day   who the draw can reach on each day of the week
 *   Not ready    who has not claimed their account, with setup codes
 *   Import       a whole roster from a spreadsheet or a pasted list
 *                (its own page, /admin/roster/import)
 *
 * Per-person detail - profile, history, sign-in - lives on the member's own
 * page, which every name here links to.
 */

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
import { getRosterDefaults } from '../../../../lib/roster-defaults.ts';
import { todayInEastern } from '../../../../lib/dates.ts';
import { AppShell } from '../../shell.tsx';
import { RosterTable, type RosterRow } from './roster-table.tsx';
import { EligibilityMatrix, type EligibilityDay } from './eligibility.tsx';
import { UnpreparedMembersSection, type MemberPreparedness } from './unprepared-members.tsx';
import { RosterTabs, type RosterView } from './roster-tabs.tsx';

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

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const params = await searchParams;
  const view: RosterView =
    params.view === 'days' ? 'days' : params.view === 'readiness' ? 'readiness' : 'everyone';

  const semester = await getActiveSemester();
  const today = todayInEastern();

  const [rows, conflicts, upcoming, defaults] = await Promise.all([
    db.select().from(members).orderBy(asc(members.name)),
    db.select().from(standingConflicts).where(eq(standingConflicts.semesterId, semester.id)),
    db
      .select({ memberId: assignmentsTable.memberId })
      .from(assignmentsTable)
      .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
      .innerJoin(weeksTable, eq(slotsTable.weekId, weeksTable.id))
      .where(and(eq(weeksTable.semesterId, semester.id), gte(slotsTable.date, today))),
    getRosterDefaults(),
  ]);

  const conflictCount = new Map<string, number>();
  for (const c of conflicts) conflictCount.set(c.memberId, (conflictCount.get(c.memberId) ?? 0) + 1);

  const shiftCount = new Map<string, number>();
  for (const a of upcoming) shiftCount.set(a.memberId, (shiftCount.get(a.memberId) ?? 0) + 1);

  const data: RosterRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    classYear: r.classYear,
    rotation: r.rotation,
    room: r.room,
    points: r.points,
    makeupDebt: r.makeupDebt,
    exempt: r.exempt,
    exemptReason: r.exemptReason,
    hasPin: r.pinHash !== null,
    active: r.active,
    standingConflicts: conflictCount.get(r.id) ?? 0,
  }));

  const active = rows.filter((r) => r.active);
  const onDuty = active.filter((m) => !m.exempt);

  const readiness: MemberPreparedness[] = active.map((m) => ({
    id: m.id,
    name: m.name,
    rotation: m.rotation,
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
    const pool = (people: typeof onDuty) => {
      const blocked = people.filter((m) => blockedToday.has(m.id));
      return {
        total: people.length,
        available: people.length - blocked.length,
        blocked: blocked.map((m) => ({
          id: m.id,
          name: m.name,
          reason: blockedToday.get(m.id) || 'Standing conflict',
        })),
      };
    };
    return {
      ...day,
      lunch: pool(onDuty.filter((m) => m.rotation === 'lunch')),
      dinner: pool(onDuty.filter((m) => m.rotation === 'dinner')),
    };
  });

  const notSignedIn = readiness.filter((m) => !m.hasPin && !m.exempt).length;
  const exemptCount = active.length - onDuty.length;

  return (
    <AppShell
      session={session}
      active="/admin/roster"
      title="Roster"
      subtitle={`${onDuty.length} on duty · ${exemptCount} exempt · ${semester.name}`}
    >
      <RosterTabs view={view} counts={{ everyone: active.length, readiness: notSignedIn }} />

      {view === 'everyone' && (
        <RosterTable rows={data} crewDefaults={defaults.crewForYear} />
      )}

      {view === 'days' && (
        <>
          <div className="note" style={{ marginTop: 0, marginBottom: 14 }}>
            Who the draw can reach on each day, once standing conflicts are
            taken out. Exempt brothers are not counted. A thin bar is a day you
            will struggle to fill.
          </div>
          <EligibilityMatrix days={eligibility} />
        </>
      )}

      {view === 'readiness' && <UnpreparedMembersSection members={readiness} />}
    </AppShell>
  );
}
