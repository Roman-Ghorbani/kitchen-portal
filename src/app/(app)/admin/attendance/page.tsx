import { redirect } from 'next/navigation';
import { eq, asc, inArray } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
} from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { parseISO, addDays } from '../../../../lib/dates.ts';
import { AppShell } from '../../shell.tsx';
import { AttendanceControls, type RosterOption } from './attendance-controls.tsx';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/my-shifts');

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date ?? today;

  const semester = await getActiveSemester();

  const weekRows = await db
    .select()
    .from(weeks)
    .where(eq(weeks.semesterId, semester.id));

  const slotRows = weekRows.length
    ? await db
        .select()
        .from(slotsTable)
        .where(eq(slotsTable.date, date))
        .orderBy(asc(slotsTable.meal))
    : [];

  const assignmentRows = slotRows.length
    ? await db
        .select()
        .from(assignmentsTable)
        .where(
          inArray(
            assignmentsTable.slotId,
            slotRows.map((s) => s.id),
          ),
        )
    : [];

  const roster = await db
    .select({ id: members.id, name: members.name, active: members.active })
    .from(members)
    .orderBy(asc(members.name));

  const nameById = new Map(roster.map((m) => [m.id, m.name]));
  const rosterOptions: RosterOption[] = roster
    .filter((m) => m.active)
    .map((m) => ({ id: m.id, name: m.name }));

  const bySlot = new Map<string, typeof assignmentRows>();
  for (const a of assignmentRows) {
    const list = bySlot.get(a.slotId) ?? [];
    list.push(a);
    bySlot.set(a.slotId, list);
  }

  return (
    <AppShell
      session={session}
      active="/admin/attendance"
      title="Attendance"
      subtitle={fmt(date)}
    >
      <div className="week-toggle">
        <a href={`/admin/attendance?date=${addDays(date, -1)}`}>← Previous day</a>
        {date !== today && <a href="/admin/attendance">Today</a>}
        <a href={`/admin/attendance?date=${addDays(date, 1)}`}>Next day →</a>
      </div>

      <div className="note">
        Everyone is assumed to have shown up. Only touch this when someone did
        not — or to drop in a substitute. Corrections apply immediately, and
        points and make-up debt adjust themselves however many times you change
        your mind.
      </div>

      {slotRows.length === 0 ? (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            No meal service scheduled for {fmt(date)}.
          </div>
        </div>
      ) : (
        slotRows.map((slot) => {
          const list = bySlot.get(slot.id) ?? [];
          return (
            <div key={slot.id} style={{ marginTop: 18 }}>
              <h2 className="section-title" style={{ marginBottom: 8 }}>
                {slot.meal === 'lunch' ? 'Lunch' : 'Dinner'} · {list.length}/
                {slot.size}
              </h2>

              {list.length === 0 && (
                <div className="card card-pad">
                  <span className="empty-slot">Nobody assigned</span>
                </div>
              )}

              {list.map((a) => (
                <div key={a.id} className="att-row">
                  <div className="att-who">
                    <div className="att-name">
                      {nameById.get(a.memberId) ?? 'Unknown'}
                      {a.isMakeup && <span className="tag bad">make-up</span>}
                    </div>
                    {a.coveredByMemberId && (
                      <div className="att-sub">
                        Covered by {nameById.get(a.coveredByMemberId)}
                      </div>
                    )}
                    <div className="att-status">
                      <span
                        className={`tag ${
                          a.status === 'no-show'
                            ? 'bad'
                            : a.status === 'assigned'
                              ? 'ok'
                              : 'locked'
                        }`}
                      >
                        {a.status === 'assigned' ? 'present' : a.status}
                      </span>
                      {a.pointsAwarded > 0 && (
                        <span className="att-pts mono">
                          +{a.pointsAwarded} pt{a.pointsAwarded === 1 ? '' : 's'}
                        </span>
                      )}
                      {a.debtAwarded > 0 && (
                        <span className="att-pts mono owed">
                          owes {a.debtAwarded}
                        </span>
                      )}
                    </div>
                  </div>

                  <AttendanceControls
                    assignmentId={a.id}
                    status={a.status}
                    roster={rosterOptions}
                    currentSub={a.coveredByMemberId}
                    multiplier={a.multiplier}
                  />
                </div>
              ))}
            </div>
          );
        })
      )}
    </AppShell>
  );
}
