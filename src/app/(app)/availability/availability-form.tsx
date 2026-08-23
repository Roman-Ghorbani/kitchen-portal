'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { setStandingConflict } from '../../actions/availability-actions.ts';

const FULL = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface DayState {
  dayIndex: number;
  blocked: boolean;
  note: string;
  hasService: boolean;
}

/**
 * One instruction, one gesture.
 *
 * Everyone starts free. Tapping a day blocks it. The button label states what
 * the day IS, never what tapping would do - the old Available/Unavailable
 * toggle was ambiguous about which of those it meant, which is exactly the
 * kind of thing that stops people using it at all.
 */
export function AvailabilityForm({
  initial,
  mealLabel,
}: {
  initial: DayState[];
  mealLabel: string;
}) {
  const [days, setDays] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const router = useRouter();

  const service = days.filter((d) => d.hasService);
  const blocked = service.filter((d) => d.blocked);
  const free = service.filter((d) => !d.blocked);

  function toggle(dayIndex: number) {
    const day = days.find((d) => d.dayIndex === dayIndex)!;
    const next = !day.blocked;

    setDays((prev) =>
      prev.map((d) => (d.dayIndex === dayIndex ? { ...d, blocked: next } : d)),
    );
    setFlash(null);

    startTransition(async () => {
      const res = await setStandingConflict(dayIndex, next, day.note);
      if (res.ok) {
        setFlash(
          next
            ? `Saved — you will never be scheduled on ${FULL[dayIndex]}s.`
            : `Saved — ${FULL[dayIndex]}s are open again.`,
        );
      } else {
        setDays((prev) =>
          prev.map((d) =>
            d.dayIndex === dayIndex ? { ...d, blocked: !next } : d,
          ),
        );
        setFlash(res.message);
      }
      router.refresh();
    });
  }

  function saveNote(dayIndex: number, note: string) {
    const day = days.find((d) => d.dayIndex === dayIndex)!;
    if (day.note === note) return;

    setDays((prev) =>
      prev.map((d) => (d.dayIndex === dayIndex ? { ...d, note } : d)),
    );
    if (!day.blocked) return;

    startTransition(async () => {
      await setStandingConflict(dayIndex, true, note);
      router.refresh();
    });
  }

  return (
    <div className="avail-container">
      <div className="avail-header">
        <h2>Set your recurring conflicts</h2>
        <p className="avail-sub-text">
          Select any day you have a recurring class or conflict during {mealLabel}.
        </p>
      </div>

      <div className="avail-days">
        {days.map((d) => {
          if (!d.hasService) {
            return (
              <div key={d.dayIndex} className="avail-chip none">
                <span className="avail-chip-day">{SHORT[d.dayIndex]}</span>
                <span className="avail-chip-state">No service</span>
              </div>
            );
          }

          return (
            <button
              key={d.dayIndex}
              className={`avail-chip${d.blocked ? ' blocked' : ' free'}`}
              onClick={() => toggle(d.dayIndex)}
              disabled={pending}
              type="button"
              aria-pressed={d.blocked}
            >
              <span className="avail-chip-day">{SHORT[d.dayIndex]}</span>
              <span className="avail-chip-state">
                {d.blocked ? 'Unavailable' : 'Available'}
              </span>
            </button>
          );
        })}
      </div>

      {flash && <div className="avail-flash">{flash}</div>}

      {blocked.length > 0 && (
        <div className="avail-notes">
          <div className="avail-notes-title">Reason / Note (optional):</div>
          {blocked.map((d) => (
            <div key={d.dayIndex} className="avail-note-row">
              <span className="avail-note-day">{FULL[d.dayIndex]}</span>
              <input
                className="field"
                placeholder="e.g. Chem lab"
                defaultValue={d.note}
                onBlur={(e) => saveNote(d.dayIndex, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
