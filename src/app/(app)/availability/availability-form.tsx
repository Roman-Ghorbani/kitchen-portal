'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { setStandingConflict } from '../../actions/availability-actions.ts';

const DAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export interface DayState {
  dayIndex: number;
  blocked: boolean;
  note: string;
  /** False on days the house does not serve this person's meal. */
  hasService: boolean;
}

export function AvailabilityForm({
  initial,
  mealLabel,
}: {
  initial: DayState[];
  mealLabel: string;
}) {
  const [days, setDays] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function toggle(dayIndex: number) {
    const day = days.find((d) => d.dayIndex === dayIndex)!;
    const next = !day.blocked;

    setDays((prev) =>
      prev.map((d) => (d.dayIndex === dayIndex ? { ...d, blocked: next } : d)),
    );

    startTransition(async () => {
      const res = await setStandingConflict(dayIndex, next, day.note);
      setMessage(res.message);
      if (!res.ok) {
        // Put the toggle back if the server refused.
        setDays((prev) =>
          prev.map((d) =>
            d.dayIndex === dayIndex ? { ...d, blocked: !next } : d,
          ),
        );
      }
      router.refresh();
    });
  }

  function saveNote(dayIndex: number, note: string) {
    setDays((prev) =>
      prev.map((d) => (d.dayIndex === dayIndex ? { ...d, note } : d)),
    );
    const day = days.find((d) => d.dayIndex === dayIndex)!;
    if (!day.blocked) return;

    startTransition(async () => {
      await setStandingConflict(dayIndex, true, note);
      router.refresh();
    });
  }

  const blockedCount = days.filter((d) => d.blocked && d.hasService).length;
  const serviceCount = days.filter((d) => d.hasService).length;

  return (
    <>
      {days.map((d) => {
        if (!d.hasService) {
          return (
            <div key={d.dayIndex} className="avail-day muted">
              <div className="avail-label">
                {DAYS[d.dayIndex]}
                <span className="avail-sub">no {mealLabel} service</span>
              </div>
            </div>
          );
        }

        return (
          <div key={d.dayIndex} className={`avail-day${d.blocked ? ' off' : ''}`}>
            <div className="avail-label">
              {DAYS[d.dayIndex]}
              <span className="avail-sub">{mealLabel}</span>
            </div>

            {d.blocked && (
              <input
                className="field avail-note"
                placeholder="Reason (optional) — e.g. Chem lab"
                defaultValue={d.note}
                onBlur={(e) => saveNote(d.dayIndex, e.target.value)}
              />
            )}

            <button
              className={`btn sm${d.blocked ? ' danger-on' : ''}`}
              onClick={() => toggle(d.dayIndex)}
              disabled={pending}
            >
              {d.blocked ? 'Unavailable' : 'Available'}
            </button>
          </div>
        );
      })}

      {message && <div className="note">{message}</div>}

      {blockedCount >= serviceCount && (
        <div className="note warn">
          You have blocked every service day. You will never be auto-scheduled,
          which Roman will notice — set only the days you genuinely cannot make.
        </div>
      )}
    </>
  );
}
