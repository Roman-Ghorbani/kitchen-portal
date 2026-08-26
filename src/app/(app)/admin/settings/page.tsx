import { redirect } from 'next/navigation';

import { getSession } from '../../../../lib/session.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import type { MealDayConfig, Meal } from '../../../../lib/types.ts';
import { AppShell } from '../../shell.tsx';
import { MealGrid } from './meal-grid.tsx';
import { LatePlateToggle } from './late-plate-toggle.tsx';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/my-shifts');

  const semester = await getActiveSemester();
  const mealDays = semester.mealDays as MealDayConfig;
  const slotSizes = semester.slotSizes as Record<Meal, number>;
  const latePlatesEnabled = semester.latePlatesEnabled ?? true;

  return (
    <AppShell
      session={session}
      active="/admin/settings"
      title="Settings"
      subtitle={semester.name}
    >
      <div className="card card-pad">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Meal service
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 0 }}>
          Which days the house actually serves. Days that are off produce no
          slots, so nobody is ever assigned a shift that does not exist.
        </p>
        <MealGrid initial={mealDays} />
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Late plate tool
        </h2>
        <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 0 }}>
          Control brother access to the late plate request system. Keep paused
          while testing live so brothers can see where the tool is without
          submitting requests before the kitchen is ready.
        </p>
        <LatePlateToggle initialEnabled={latePlatesEnabled} />
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          House rules
        </h2>
        <dl className="rules">
          <dt>Staffing</dt>
          <dd>
            {slotSizes.lunch} juniors on lunch, {slotSizes.dinner} sophomores on
            dinner. Fixed by house rule.
          </dd>

          <dt>Frequency</dt>
          <dd>
            Nobody is auto-scheduled more than once a Monday–Sunday week. The
            only exception is a make-up shift owed for a no-show.
          </dd>

          <dt>Selection</dt>
          <dd>
            Make-up debt first, then fewest points, then longest since last
            served, then a seeded random draw. The seed is the week itself, so
            regenerating produces the identical schedule rather than reshuffling.
          </dd>

          <dt>Coverage</dt>
          <dd>
            Only the person who covers earns the point. The original assignee&apos;s
            obligation is not cleared — they stay in the pool at their current
            total and come back up in rotation normally.
          </dd>

          <dt>Cadence</dt>
          <dd>
            A week is posted at Sunday chapter and starts 8 days later, so it is
            open for conflict flags for a full 7 days. It locks at the chapter
            immediately before it runs — never after.
          </dd>

          <dt>Attendance</dt>
          <dd>
            Everyone is assumed present. Corrections apply immediately and
            adjust points and make-up debt by the difference, so changing your
            mind is always safe.
          </dd>
        </dl>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Semester
        </h2>
        <div style={{ fontSize: 13.5 }}>
          <strong>{semester.name}</strong> ·{' '}
          <span className="mono">
            {semester.startsOn} → {semester.endsOn}
          </span>
        </div>
        <div className="note">
          Points reset to zero at the start of each semester. Starting the
          Spring 2027 term is a deliberate action, not automatic.
        </div>
      </div>
    </AppShell>
  );
}
