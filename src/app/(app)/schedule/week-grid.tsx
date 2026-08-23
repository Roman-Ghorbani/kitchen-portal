import { parseISO } from '../../../lib/dates.ts';
import { formatPoints } from '../../../lib/types.ts';
import type { DisplaySlot, DisplayWeek } from '../../../lib/week-service.ts';
import { CoverButton } from './cover-button.tsx';
import { ClaimSeatButton } from './claim-seat.tsx';

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

function PersonChip({
  assignment,
  meId,
  canCover,
  isAdmin,
}: {
  assignment: DisplaySlot['assignments'][number];
  meId: string;
  canCover: boolean;
  isAdmin: boolean;
}) {
  const a = assignment;
  const mine = a.memberId === meId || a.coveredByMemberId === meId;
  const flagged = a.status === 'flagged';
  const served = a.coveredByName ?? a.memberName;
  const seesLedger = mine || isAdmin;

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

      <span className="wg-name">
        {a.coveredByName ? (
          <>
            <b>{a.coveredByName}</b>
            <em>covering {a.memberName}</em>
          </>
        ) : (
          <b>{a.memberName}</b>
        )}
      </span>

      {/* What an assigned brother earns is between him and the kitchen
          manager, so it shows only to him. A bounty on a shift that is OPEN is
          the opposite: it is an offer, and an offer nobody can see cannot be
          taken up. */}
      {seesLedger && !flagged && a.multiplier > 1 && (
        <span className="wg-mult mono">{formatPoints(a.multiplier)}×</span>
      )}
      {seesLedger && a.isMakeup && (
        <span className="wg-badge makeup">make-up</span>
      )}
      {a.status === 'no-show' && <span className="wg-badge bad">no-show</span>}

      {flagged && (
        <span className="wg-open">
          <span className="wg-badge bad">needs cover</span>
          {a.multiplier > 1 && (
            <span className="wg-bounty mono">
              {formatPoints(a.multiplier)}× points
            </span>
          )}
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
  meal,
  index,
  meId,
  canCover,
  isAdmin,
  isToday,
  isPast,
}: {
  slot: DisplaySlot | null;
  meal: 'lunch' | 'dinner';
  index: number;
  meId: string;
  canCover: boolean;
  isAdmin: boolean;
  isToday: boolean;
  isPast: boolean;
}) {
  const cls =
    `wg-cell ${meal}` +
    (isToday ? ' today' : '') +
    (isPast ? ' past' : '') +
    (slot ? '' : ' empty');

  return (
    <div className={cls} style={{ ['--i' as string]: String(index) }}>
      {/* Visible only in the mobile layout, where columns are meals not days. */}
      <span className="wg-cell-tag">{meal === 'lunch' ? 'Lunch' : 'Dinner'}</span>

      {!slot ? (
        <span className="wg-noservice">No service</span>
      ) : (
        <>
          {slot.assignments.map((a) => (
            <PersonChip
              key={a.id}
              assignment={a}
              meId={meId}
              canCover={canCover}
              isAdmin={isAdmin}
            />
          ))}
          {slot.size - slot.assignments.length > 0 && (
            <div className="wg-unfilled">
              <span className="wg-unfilled-label">
                {slot.size - slot.assignments.length} seat
                {slot.size - slot.assignments.length === 1 ? '' : 's'} open
                {slot.coverBounty > 1 &&
                  ` · ${formatPoints(slot.coverBounty)}× points`}
              </span>
              {canCover && (
                <ClaimSeatButton slotId={slot.id} bounty={slot.coverBounty} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A whole week at a glance.
 *
 * One set of markup, two layouts. On a wide screen days run across as columns
 * with lunch and dinner as rows. On a phone that is physically impossible -
 * six columns of readable names needs about 900px - so the same grid flips:
 * days become rows and the two meals become the columns. Every item carries
 * its day index as a custom property, and the stylesheet places it, so
 * nothing is rendered twice and there is no duplicate DOM to keep in sync.
 */
export function WeekGrid({
  week,
  meId,
  canCover,
  isAdmin,
  today,
}: {
  week: DisplayWeek;
  meId: string;
  canCover: boolean;
  isAdmin: boolean;
  today: string;
}) {
  const days = week.days;

  return (
    <div className="week-grid" style={{ ['--wg-cols' as string]: String(days.length) }}>
      <div className="wg-corner" />

      <div className="wg-head lunch">
        <span className="wg-head-name">Lunch</span>
        <span className="wg-head-sub">juniors</span>
      </div>
      <div className="wg-head dinner">
        <span className="wg-head-name">Dinner</span>
        <span className="wg-head-sub">sophomores</span>
      </div>

      {days.map((d, i) => (
        <div
          key={`day-${d.date}`}
          className={
            'wg-day' +
            (d.date === today ? ' today' : '') +
            (d.date < today ? ' past' : '')
          }
          style={{ ['--i' as string]: String(i) }}
        >
          <span className="wg-dow">{dow(d.date)}</span>
          <span className="wg-date">
            <span className="wg-num">{dayOfMonth(d.date)}</span>
            <span className="wg-mon">{monthOf(d.date)}</span>
          </span>
          {d.date === today && <span className="wg-today-chip">Today</span>}
        </div>
      ))}

      {days.map((d, i) => (
        <SlotCell
          key={`l-${d.date}`}
          slot={d.lunch}
          meal="lunch"
          index={i}
          meId={meId}
          canCover={canCover}
          isAdmin={isAdmin}
          isToday={d.date === today}
          isPast={d.date < today}
        />
      ))}

      {days.map((d, i) => (
        <SlotCell
          key={`d-${d.date}`}
          slot={d.dinner}
          meal="dinner"
          index={i}
          meId={meId}
          canCover={canCover}
          isAdmin={isAdmin}
          isToday={d.date === today}
          isPast={d.date < today}
        />
      ))}
    </div>
  );
}
