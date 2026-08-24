import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, eq, and, gte } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import { members, standingConflicts, assignments as assignmentsTable, slots as slotsTable, weeks as weeksTable } from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { todayInEastern } from '../../../../lib/dates.ts';
import { AppShell } from '../../shell.tsx';
import { UnpreparedMembersSection, type MemberPreparedness } from './unprepared-members.tsx';

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

export default async function AdminStatsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/my-shifts');

  const semester = await getActiveSemester();

  const today = todayInEastern();

  const [roster, conflictRows, upcomingAssignments] = await Promise.all([
    db
      .select()
      .from(members)
      .where(eq(members.active, true))
      .orderBy(asc(members.name)),
    db
      .select()
      .from(standingConflicts)
      .where(eq(standingConflicts.semesterId, semester.id)),
    db
      .select({
        memberId: assignmentsTable.memberId,
        date: slotsTable.date,
      })
      .from(assignmentsTable)
      .innerJoin(slotsTable, eq(assignmentsTable.slotId, slotsTable.id))
      .innerJoin(weeksTable, eq(slotsTable.weekId, weeksTable.id))
      .where(
        and(
          eq(weeksTable.semesterId, semester.id),
          gte(slotsTable.date, today),
        ),
      ),
  ]);

  const shiftCounts = new Map<string, number>();
  for (const a of upcomingAssignments) {
    shiftCounts.set(a.memberId, (shiftCounts.get(a.memberId) ?? 0) + 1);
  }

  const standingConflictsCount = new Map<string, number>();
  for (const c of conflictRows) {
    standingConflictsCount.set(c.memberId, (standingConflictsCount.get(c.memberId) ?? 0) + 1);
  }

  const memberPreparednessData: MemberPreparedness[] = roster.map((m) => {
    const upcomingCount = shiftCounts.get(m.id) ?? 0;
    return {
      id: m.id,
      name: m.name,
      classYear: m.classYear,
      exempt: m.exempt,
      hasPin: m.pinHash !== null,
      standingConflictsCount: standingConflictsCount.get(m.id) ?? 0,
      isScheduled: upcomingCount > 0,
      upcomingShiftsCount: upcomingCount,
    };
  });

  const juniors = roster.filter((m) => m.classYear === 'junior');
  const sophomores = roster.filter((m) => m.classYear === 'sophomore');
  const exempt = roster.filter((m) => m.exempt);
  const owingMakeup = roster.filter((m) => m.makeupDebt > 0);

  // Map conflicts by day index and member id
  const conflictsByDay = DAYS.map((day) => {
    const dayConflicts = conflictRows.filter((c) => c.dayIndex === day.index);
    const blockedMap = new Map(dayConflicts.map((c) => [c.memberId, c.note]));

    const blockedJuniors = juniors.filter(
      (m) => m.exempt || blockedMap.has(m.id),
    );
    const availableJuniors = juniors.filter(
      (m) => !m.exempt && !blockedMap.has(m.id),
    );

    const blockedSophomores = sophomores.filter(
      (m) => m.exempt || blockedMap.has(m.id),
    );
    const availableSophomores = sophomores.filter(
      (m) => !m.exempt && !blockedMap.has(m.id),
    );

    return {
      day,
      lunch: {
        total: juniors.length,
        available: availableJuniors.length,
        availableList: availableJuniors,
        blocked: blockedJuniors.map((m) => ({
          member: m,
          reason: m.exempt
            ? `Exempt (${m.exemptReason ?? 'no reason'})`
            : blockedMap.get(m.id) || 'Standing Conflict',
        })),
      },
      dinner: {
        total: sophomores.length,
        available: availableSophomores.length,
        availableList: availableSophomores,
        blocked: blockedSophomores.map((m) => ({
          member: m,
          reason: m.exempt
            ? `Exempt (${m.exemptReason ?? 'no reason'})`
            : blockedMap.get(m.id) || 'Standing Conflict',
        })),
      },
    };
  });

  return (
    <AppShell
      session={session}
      active="/admin/stats"
      title="Stats & Eligibility"
      subtitle="Duty pool capacity, member app readiness, and daily eligibility"
    >
      <UnpreparedMembersSection members={memberPreparednessData} />
      <div className="dossier-stats" style={{ marginBottom: 24 }}>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{juniors.length}</span>
          <span className="dossier-stat-label">Juniors (Lunch)</span>
        </div>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{sophomores.length}</span>
          <span className="dossier-stat-label">Sophomores (Dinner)</span>
        </div>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{conflictRows.length}</span>
          <span className="dossier-stat-label">Standing Conflicts</span>
        </div>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{exempt.length}</span>
          <span className="dossier-stat-label">Exempt Members</span>
        </div>
        <div className={`dossier-stat${owingMakeup.length > 0 ? ' bad' : ''}`}>
          <span className="dossier-stat-value mono">{owingMakeup.length}</span>
          <span className="dossier-stat-label">Owing Make-up</span>
        </div>
      </div>

      <h2 className="section-title">
        Daily Duty Eligibility Matrix
        <span className="section-count mono">7 Days</span>
      </h2>

      <div
        className="stats-grid"
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {conflictsByDay.map(({ day, lunch, dinner }) => {
          const lunchPct =
            lunch.total > 0
              ? Math.round((lunch.available / lunch.total) * 100)
              : 100;
          const dinnerPct =
            dinner.total > 0
              ? Math.round((dinner.available / dinner.total) * 100)
              : 100;

          return (
            <div key={day.index} className="card card-pad">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {day.full}
                </h3>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-400)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  Lunch: {lunch.available}/{lunch.total} eligible ({lunchPct}%) ·
                  Dinner: {dinner.available}/{dinner.total} eligible ({dinnerPct}%)
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 16,
                }}
              >
                {/* LUNCH STATS */}
                <div
                  style={{
                    background: 'var(--navy-50)',
                    border: '1px solid var(--navy-100)',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold-500)' }}>
                      ☀️ LUNCH (Juniors)
                    </span>
                    <span className="tag ok" style={{ fontSize: 11 }}>
                      {lunch.available} Available
                    </span>
                  </div>

                  {lunch.blocked.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                      All {lunch.total} juniors are available for lunch on {day.short}.
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--red-600)',
                          marginBottom: 4,
                          textTransform: 'uppercase',
                        }}
                      >
                        Unavailable / Blocked ({lunch.blocked.length}):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {lunch.blocked.map(({ member, reason }) => (
                          <div
                            key={member.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 12,
                              background: 'var(--card)',
                              padding: '4px 8px',
                              borderRadius: 6,
                            }}
                          >
                            <Link
                              href={`/admin/member/${member.id}`}
                              style={{ fontWeight: 600, color: 'inherit' }}
                            >
                              {member.name}
                            </Link>
                            <span className="tag bad" style={{ fontSize: 10 }}>
                              {reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* DINNER STATS */}
                <div
                  style={{
                    background: 'var(--navy-50)',
                    border: '1px solid var(--navy-100)',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold-500)' }}>
                      🌙 DINNER (Sophomores)
                    </span>
                    <span className="tag ok" style={{ fontSize: 11 }}>
                      {dinner.available} Available
                    </span>
                  </div>

                  {dinner.blocked.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                      All {dinner.total} sophomores are available for dinner on {day.short}.
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--red-600)',
                          marginBottom: 4,
                          textTransform: 'uppercase',
                        }}
                      >
                        Unavailable / Blocked ({dinner.blocked.length}):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {dinner.blocked.map(({ member, reason }) => (
                          <div
                            key={member.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 12,
                              background: 'var(--card)',
                              padding: '4px 8px',
                              borderRadius: 6,
                            }}
                          >
                            <Link
                              href={`/admin/member/${member.id}`}
                              style={{ fontWeight: 600, color: 'inherit' }}
                            >
                              {member.name}
                            </Link>
                            <span className="tag bad" style={{ fontSize: 10 }}>
                              {reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
