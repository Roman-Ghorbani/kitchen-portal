import { redirect } from 'next/navigation';

import { getSession, getViewAs } from '../../../lib/session.ts';
import { getMemberById } from '../../../lib/member-queries.ts';
import { getMyConflicts } from '../../actions/availability-actions.ts';
import { getActiveSemester } from '../../../lib/week-service.ts';
import { type MealDayConfig } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { AvailabilityForm, type DayState } from './availability-form.tsx';

export const dynamic = 'force-dynamic';

const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export default async function AvailabilityPage() {
  const session = await getSession();
  if (!session) redirect('/signin');

  const viewAs = await getViewAs();
  if (session.role === 'admin' && !viewAs) redirect('/admin');
  const memberId = viewAs ?? session.sub;
  const readOnly = session.role === 'admin';

  const [member, conflicts, semester] = await Promise.all([
    getMemberById(memberId),
    getMyConflicts(memberId),
    getActiveSemester(),
  ]);

  if (!member) redirect('/signin');

  const meal = member.rotation;
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
      viewingAs={readOnly ? (member?.name ?? null) : null}
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
        {readOnly ? (
          <div className="preview-readonly">
            {initial.filter((d) => d.blocked).length === 0 ? (
              <span className="note">No days blocked.</span>
            ) : (
              <ul className="preview-days">
                {initial
                  .filter((d) => d.blocked)
                  .map((d) => (
                    <li key={d.dayIndex}>
                      <strong>{DAY_NAMES[d.dayIndex]}</strong>
                      {d.note ? ` — ${d.note}` : ''}
                    </li>
                  ))}
              </ul>
            )}
            <span className="note">
              Read only while you are looking through somebody else&apos;s
              account. Change it from his record instead.
            </span>
          </div>
        ) : (
          <AvailabilityForm initial={initial} mealLabel={meal} />
        )}
      </div>
    </AppShell>
  );
}
