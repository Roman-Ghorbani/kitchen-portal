import { parseISO, daysBetween } from '../../lib/dates.ts';
import type { ScheduleHorizon } from '../../lib/week-service.ts';

function longDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * States plainly how far ahead the schedule goes.
 *
 * Without this, an empty shift list is ambiguous between "you have no duty
 * coming up" and "nothing has been posted that far out yet" - and that
 * ambiguity is exactly what turns into "nobody ever told me I was on".
 */
export function HorizonNote({
  horizon,
  today,
}: {
  horizon: ScheduleHorizon;
  today: string;
}) {
  if (!horizon.lastDate) {
    return (
      <div className="horizon none">
        <span className="horizon-label">Not posted yet</span>
        <span className="horizon-detail">
          No schedule has been published for this semester.
        </span>
      </div>
    );
  }

  const daysOut = daysBetween(today, horizon.lastDate);

  return (
    <div className={`horizon${daysOut < 3 ? ' soon' : ''}`}>
      <span className="horizon-label">
        Scheduled through {longDate(horizon.lastDate)}
      </span>
      <span className="horizon-detail">
        {horizon.weeksPosted} week{horizon.weeksPosted === 1 ? '' : 's'} posted ·{' '}
        {daysOut < 0
          ? 'the posted schedule has already run out'
          : daysOut === 0
            ? 'the last scheduled day is today'
            : `${daysOut} day${daysOut === 1 ? '' : 's'} out`}
        . Nothing is assigned past that date yet.
      </span>
    </div>
  );
}
