import { parseISO, daysBetween } from '../../lib/dates.ts';
import type { ScheduleHorizon } from '../../lib/week-service.ts';

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function HorizonNote({
  horizon,
  today,
}: {
  horizon: ScheduleHorizon;
  today: string;
}) {
  if (!horizon.lastDate) return null;

  const daysOut = daysBetween(today, horizon.lastDate);

  return (
    <div className={`horizon-chip${daysOut < 3 ? ' soon' : ''}`}>
      <span className="horizon-dot" />
      <span>
        Schedule posted through <strong>{shortDate(horizon.lastDate)}</strong> ({daysOut > 0 ? `${daysOut} days out` : 'today'})
      </span>
    </div>
  );
}
