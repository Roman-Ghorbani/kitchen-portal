import { parseISO } from '../../../lib/dates.ts';
import type { DisplaySlot, DisplayWeek } from '../../../lib/week-service.ts';
import { CoverButton } from './cover-button.tsx';

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function dow(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function dayOfMonth(iso: string): string {
  return String(parseISO(iso).getUTCDate());
}

function monthOf(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * One person on one shift.
 *
 * Kept deliberately compact: the whole point of the grid is that a week fits
 * on one screen, so a chip is an avatar plus a name and nothing else unless
 * something is actually wrong with it.
 */
function PersonCell({
  assignment,
  meId,
  canCover,
}: {
  assignment: DisplaySlot['assignments'][number];
  meId: string;
  canCover: boolean;
}) {
  const a = assignment;
  const mine = a.memberId === meId || a.coveredByMemberId === meId;
  const flagged = a.status === 'flagged';
  const served = a.coveredByName ?? a.memberName;

  return (
    <div
      className={
        'wg-person' +
        (mine ? ' is-me' : '') +
        (flagged ? ' flagged' : '') +
        (a.status === 'no-show' ? ' noshow' : '')
      }
    >
      <span className={`avatar${mine ? ' me' : ''}`}>{initials(served)}</span>

      <span className="wg-person-name">
        {a.coveredByName ? (
          <>
            <span className="wg-covered-by">{a.coveredByName}</span>
            <span className="wg-replaced">for {a.memberName}</span>
          </>
        ) : (
          a.memberName
        )}
      </span>

      {a.multiplier > 1 && <span className="wg-mult mono">{a.multiplier}x</span>}
      {a.isMakeup && <span className="wg-badge makeup">make-up</span>}
      {a.status === 'no-show' && <span className="wg-badge bad">no-show</span>}

      {flagged && (
        <span className="wg-open">
          <span className="wg-badge bad">needs cover</span>
          {canCover && a.memberId !== meId && (
            <CoverButton assignmentId={a.id} label="Pick up" />
          )}
        </span>
      )}
    </div>
  );
}

function SlotCell({
  slot,
  meId,
  canCover,
  isToday,
}: {
  slot: DisplaySlot | null;
  meId: string;
  canCover: boolean;
  isToday: boolean;
}) {
  if (!slot) {
    return (
      <div className={`wg-cell empty${isToday ? ' today' : ''}`}>
        <span className="wg-noservice">no service</span>
      </div>
    );
  }

  const unfilled = slot.size - slot.assignments.length;

  return (
    <div className={`wg-cell${isToday ? ' today' : ''}`}>
      {slot.assignments.map((a) => (
        <PersonCell key={a.id} assignment={a} meId={meId} canCover={canCover} />
      ))}
      {unfilled > 0 && (
        <div className="wg-unfilled">
          {unfilled} unfilled seat{unfilled === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

export function WeekGrid({
  week,
  meId,
  canCover,
  today,
}: {
  week: DisplayWeek;
  meId: string;
  canCover: boolean;
  today: string;
}) {
  const days = week.days;

  return (
    <div className="wg-scroll">
      <div
        className="week-grid"
        style={{ ['--wg-cols' as string]: String(days.length) }}
      >
        {/* header row */}
        <div className="wg-corner" />
        {days.map((d) => (
          <div
            key={`h-${d.date}`}
            className={`wg-day${d.date === today ? ' today' : ''}`}
          >
            <span className="wg-dow">{dow(d.date)}</span>
            <span className="wg-date">
              <span className="wg-num">{dayOfMonth(d.date)}</span>
              <span className="wg-mon">{monthOf(d.date)}</span>
            </span>
            {d.date === today && <span className="wg-today-chip">Today</span>}
          </div>
        ))}

        {/* lunch row */}
        <div className="wg-label lunch">
          <span className="wg-label-name">Lunch</span>
          <span className="wg-label-sub">juniors</span>
        </div>
        {days.map((d) => (
          <SlotCell
            key={`l-${d.date}`}
            slot={d.lunch}
            meId={meId}
            canCover={canCover}
            isToday={d.date === today}
          />
        ))}

        {/* dinner row */}
        <div className="wg-label dinner">
          <span className="wg-label-name">Dinner</span>
          <span className="wg-label-sub">sophomores</span>
        </div>
        {days.map((d) => (
          <SlotCell
            key={`d-${d.date}`}
            slot={d.dinner}
            meId={meId}
            canCover={canCover}
            isToday={d.date === today}
          />
        ))}
      </div>
    </div>
  );
}
