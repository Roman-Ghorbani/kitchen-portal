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
      subtitle="Set this once — it applies every week"
    >
      <div className="alert info">
        <span className="alert-title">This is the setting that saves you hassle</span>
        <span className="alert-body">
          You are a {member.classYear}, so you only ever get{' '}
          <strong>{meal}</strong>. Block a day here and you are simply never
          scheduled then — no flagging every week, nothing to forget, and no
          argument later about whether you told anyone.
        </span>
      </div>

      <div className="card card-pad">
        <AvailabilityForm initial={initial} mealLabel={meal} />
      </div>

      <div className="note">
        Changes apply to weeks generated from now on. If you are already on a
        posted week, flag that shift from <strong>My Shifts</strong> as well.
      </div>
    </AppShell>
  );
}
