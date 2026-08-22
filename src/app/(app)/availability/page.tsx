import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import { getMemberById } from '../../../lib/member-queries.ts';
import { getMyConflicts } from '../../actions/availability-actions.ts';
import { getActiveSemester } from '../../../lib/week-service.ts';
import { MEAL_FOR_YEAR, type MealDayConfig } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { AvailabilityForm, type DayState } from './availability-form.tsx';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role === 'admin') redirect('/admin');

  const [member, conflicts, semester] = await Promise.all([
    getMemberById(session.sub),
    getMyConflicts(),
    getActiveSemester(),
  ]);

  if (!member) redirect('/signin');

  const meal = MEAL_FOR_YEAR[member.classYear];
  const mealDays = semester.mealDays as MealDayConfig;
  const byDay = new Map(conflicts.map((c) => [c.dayIndex, c.note ?? '']));

  const initial: DayState[] = Array.from({ length: 7 }, (_, i) => ({
    dayIndex: i,
    blocked: byDay.has(i),
    note: byDay.get(i) ?? '',
    hasService: mealDays[meal][i],
  }));

  return (
    <AppShell
      session={session}
      active="/availability"
      title="My Availability"
      subtitle={`Standing weekly conflicts · ${semester.name}`}
    >
      <div className="card card-pad">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Which days can you never make {meal}?
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 0 }}>
          You are a {member.classYear}, so you are only ever scheduled for{' '}
          <strong>{meal}</strong>. Mark a day unavailable and you simply will not
          be scheduled then — no flagging, no reminders, nothing to forget.
        </p>

        <AvailabilityForm initial={initial} mealLabel={meal} />

        <div className="note">
          This is the setting that saves you the most hassle. A recurring class
          conflict set once here beats flagging the same shift every week — and
          it means a missed shift is never something you can say you were never
          asked about.
        </div>
      </div>
    </AppShell>
  );
}
