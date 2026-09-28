'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { toggleMealDay } from '../../../actions/settings-actions.ts';
import type { Meal, MealDayConfig } from '../../../../lib/types.ts';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MealGrid({ initial }: { initial: MealDayConfig }) {
  const [config, setConfig] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(meal: Meal, dayIndex: number) {
    const next = !config[meal][dayIndex];
    const optimistic = structuredClone(config);
    optimistic[meal][dayIndex] = next;
    setConfig(optimistic);

    startTransition(async () => {
      const res = await toggleMealDay(meal, dayIndex, next);
      setMessage(res.message);
      setFailed(!res.ok);
      if (!res.ok) setConfig(config);
      router.refresh();
    });
  }

  const seats =
    config.lunch.filter(Boolean).length * 2 +
    config.dinner.filter(Boolean).length * 3;

  return (
    <>
      <div className="meal-grid">
        <div className="meal-grid-head">
          <span />
          {DAYS.map((d) => (
            <span key={d} className="meal-day-label">{d}</span>
          ))}
        </div>

        {(['lunch', 'dinner'] as Meal[]).map((meal) => (
          <div key={meal} className="meal-grid-row">
            <span className="meal-row-label">
              {meal === 'lunch' ? 'Lunch' : 'Dinner'}
              <span className="meal-row-sub">
                {meal === 'lunch' ? 'lunch crew' : 'dinner crew'}
              </span>
            </span>
            {DAYS.map((d, i) => (
              <button
                key={d}
                className={`meal-cell${config[meal][i] ? ' on' : ''}`}
                onClick={() => toggle(meal, i)}
                disabled={pending}
                aria-label={`${meal} on ${d}`}
              >
                {config[meal][i] ? '✓' : '—'}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="note">
        <strong className="mono">{seats}</strong> seats a week. Changes affect
        weeks generated from now on — a week already posted keeps the slots the
        house was told about.
      </div>

      {message && (
        <div
          className="note"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </div>
      )}
    </>
  );
}
