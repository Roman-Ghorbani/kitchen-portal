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

  return (
    <AppShell
      session={session}
      active="/admin/roster"
      title="Roster & Points"
      subtitle={`${active.length} on duty · ${semester.name}`}
    >
      <div className="stat-grid">
        <div className="card card-pad stat-card">
          <div className="label">Point spread</div>
          <div className="value mono">{spread}</div>
          <div className="foot">
            {spread <= 1
              ? 'even — nobody is behind'
              : 'gap between most and least served'}
          </div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Juniors</div>
          <div className="value mono">
            {active.filter((d) => d.classYear === 'junior').length}
          </div>
          <div className="foot">lunch duty</div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Sophomores</div>
          <div className="value mono">
            {active.filter((d) => d.classYear === 'sophomore').length}
          </div>
          <div className="foot">dinner duty</div>
        </div>
        <div className="card card-pad stat-card">
          <div className="label">Conflicts set</div>
          <div className="value mono">{conflictCount.size}</div>
          <div className="foot">have standing availability</div>
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
