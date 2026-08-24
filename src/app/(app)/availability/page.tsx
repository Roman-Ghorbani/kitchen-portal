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
      title="Weekly Availability"
      subtitle={`${member.name} · ${meal === 'lunch' ? 'Lunch' : 'Dinner'} duty`}
    >
      <div className="alert info" style={{ marginBottom: 16 }}>
        <span className="alert-title">💡 Replaces the Old Google Excuse Form</span>
        <span className="alert-body">
          You no longer need to fill out a Google Form for class or standing conflicts! Simply select any day below to block it for the semester.
        </span>
      </div>
      <div className="card card-pad">
        <AvailabilityForm initial={initial} mealLabel={meal} />
      </div>
    </AppShell>
  );
}
