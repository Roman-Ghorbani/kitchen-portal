import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import { getWeek, getLiveWeeks, type DisplaySlot } from '../../../lib/week-service.ts';
import { AppShell } from '../shell.tsx';
import { CoverButton } from './cover-button.tsx';
import { parseISO, mondayOf, addDays } from '../../../lib/dates.ts';

export const dynamic = 'force-dynamic';

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function dow(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function dayNum(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function SlotView({
  slot,
  label,
  meId,
  canCover,
}: {
  slot: DisplaySlot | null;
  label: string;
  meId: string;
  canCover: boolean;
}) {
  if (!slot) return null;

  const openSeats = slot.size - slot.assignments.length;

  return (
    <div>
      <div className="slot-title">
        {label} · {slot.size} {slot.meal === 'lunch' ? 'juniors' : 'sophomores'}
      </div>
      <div className="slot-people">
        {slot.assignments.map((a) => {
          const mine = a.memberId === meId || a.coveredByMemberId === meId;
          const isOpen = a.status === 'flagged';

          return (
            <span
              key={a.id}
              className={
                `person-chip${mine ? ' is-me' : ''}` +
                (isOpen ? ' flagged' : '') +
                (a.status === 'no-show' ? ' noshow' : '')
              }
              title={a.isMakeup ? 'Make-up shift' : undefined}
            >
              <span className={`avatar${mine ? ' me' : ''}`}>
                {initials(a.memberName)}
              </span>

              {a.coveredByName ? (
                <>
                  <s>{a.memberName}</s> → {a.coveredByName}
                  {a.multiplier > 1 && (
                    <span className="mult mono">{a.multiplier}x</span>
                  )}
                </>
              ) : (
                a.memberName
              )}

              {a.status === 'no-show' && <span className="tag bad">no-show</span>}

              {isOpen && (
                <>
                  <span className="tag bad">needs cover</span>
                  {canCover && a.memberId !== meId && (
                    <CoverButton assignmentId={a.id} label="Pick up" />
                  )}
                </>
              )}
            </span>
          );
        })}

        {openSeats > 0 && (
          <span className="empty-slot">{openSeats} unfilled</span>
        )}
      </div>
    </div>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');

  const params = await searchParams;
  const allWeeks = await getLiveWeeks();

  if (allWeeks.length === 0) {
    return (
      <AppShell
        session={session}
        active="/schedule"
        title="Schedule"
        subtitle="No week has been posted yet"
      >
        <div className="card card-pad">
          <h2 className="section-title">Nothing posted yet</h2>
          <p className="hint" style={{ color: 'var(--ink-400)', fontSize: 13 }}>
            {session.role === 'admin'
              ? 'Generate and post the first week from the admin dashboard.'
              : 'Roman has not posted a schedule yet. Check back after chapter.'}
          </p>
        </div>
      </AppShell>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const currentMonday = mondayOf(today);

  // Default to the week currently running, falling back to the earliest posted.
  const defaultWeek =
    allWeeks.find((w) => w.weekStart === currentMonday)?.weekStart ??
    allWeeks[0].weekStart;
  const selected = params.week ?? defaultWeek;

  const week = await getWeek(selected);
  if (!week) redirect('/schedule');

  const isLocked = week.status === 'locked' || week.status === 'complete';
  const meId = session.role === 'brother' ? session.sub : '';
  // Coverage is open to anyone signed in as a brother, any class year.
  const canCover = session.role === 'brother' && !isLocked;

  return (
    <AppShell
      session={session}
      active="/schedule"
      title="Full Schedule"
      subtitle={`Week of ${dayNum(week.weekStart)} — ${week.days.length} service days`}
    >
      <div className="week-toggle">
        {allWeeks.map((w) => (
          <Link
            key={w.id}
            href={`/schedule?week=${w.weekStart}`}
            className={w.weekStart === selected ? 'active' : ''}
          >
            {w.weekStart === currentMonday
              ? 'This Week'
              : w.weekStart === addDays(currentMonday, 7)
                ? 'Next Week'
                : dayNum(w.weekStart)}
            <span className={`tag ${w.status === 'posted' ? 'ok' : 'locked'}`}>
              {w.status}
            </span>
          </Link>
        ))}
      </div>

      {isLocked && (
        <div className="note">
          This week is locked — conflict flags closed at chapter. For a genuine
          emergency, contact Roman directly.
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {week.days.map((day) => (
          <div
            key={day.date}
            className={`day-card${day.date === today ? ' today' : ''}`}
          >
            <div className="day-date">
              <div className="dow">{dow(day.date)}</div>
              <div className="daynum">{dayNum(day.date)}</div>
            </div>
            <div className="day-slots">
              <SlotView
                slot={day.lunch}
                label="Lunch"
                meId={meId}
                canCover={canCover}
              />
              <SlotView
                slot={day.dinner}
                label="Dinner"
                meId={meId}
                canCover={canCover}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="note">
        Lunch is juniors, dinner is sophomores. Your own name is outlined in
        brass. Nobody is scheduled more than once a week unless they owe a
        make-up shift.
      </div>
    </AppShell>
  );
}
