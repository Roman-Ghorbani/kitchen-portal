import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import { members, standingConflicts } from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { AppShell } from '../../shell.tsx';
import { RosterTable, type RosterRow } from './roster-table.tsx';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/my-shifts');

  const semester = await getActiveSemester();

  const [rows, conflicts] = await Promise.all([
    db.select().from(members).orderBy(asc(members.name)),
    db
      .select()
      .from(standingConflicts)
      .where(eq(standingConflicts.semesterId, semester.id)),
  ]);

  const conflictCount = new Map<string, number>();
  for (const c of conflicts) {
    conflictCount.set(c.memberId, (conflictCount.get(c.memberId) ?? 0) + 1);
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

  const active = data.filter((d) => d.active);
  const eligible = active.filter((d) => !d.exempt);
  const points = eligible.map((d) => d.points);
  const spread =
    points.length > 0 ? Math.max(...points) - Math.min(...points) : 0;

  const signedInCount = active.filter((d) => d.hasPin).length;
  const signedInPct = active.length > 0 ? Math.round((signedInCount / active.length) * 100) : 0;
  const owingCount = active.filter((d) => d.makeupDebt > 0).length;

  return (
    <AppShell
      session={session}
      active="/admin/roster"
      title="Roster & Points"
      subtitle={`${active.length} active on duty · ${semester.name}`}
    >
      <div className="stat-grid">
        <div className="card card-pad stat-card">
          <div className="label">Point spread</div>
          <div className="value mono">{spread} pts</div>
          <div className="foot">
            {spread <= 1
              ? 'even — nobody is behind'
              : 'gap between most and least served'}
          </div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Signed In Rate</div>
          <div className="value mono">{signedInPct}%</div>
          <div className="foot">{signedInCount} of {active.length} active brothers</div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Duty Pool</div>
          <div className="value mono">
            {active.filter((d) => d.classYear === 'junior').length}J / {active.filter((d) => d.classYear === 'sophomore').length}S
          </div>
          <div className="foot">Lunch vs Dinner crew</div>
        </div>
        <div className={`card card-pad stat-card${owingCount > 0 ? ' bad' : ''}`}>
          <div className="label">Owes Make-up</div>
          <div className="value mono">{owingCount}</div>
          <div className="foot">{owingCount === 0 ? 'nobody owes debt' : 'owing missed shift debt'}</div>
        </div>
      </div>

      <h2 className="section-title">Everyone</h2>
      <RosterTable rows={data} />

      <div className="note">
        Tap anyone to change their duty year, adjust points, exempt them, or
        reset a forgotten PIN. Every change here is written to the audit log
        with your name on it. Points reset to zero at the start of each semester.
      </div>
    </AppShell>
  );
}
