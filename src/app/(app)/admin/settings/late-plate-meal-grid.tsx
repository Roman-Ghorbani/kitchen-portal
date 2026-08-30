'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { toggleLatePlateDay } from '../../../actions/settings-actions.ts';
import type { Meal, MealDayConfig } from '../../../../lib/types.ts';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function LatePlateMealGrid({ initial }: { initial: MealDayConfig }) {
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
      const res = await toggleLatePlateDay(meal, dayIndex, next);
      setMessage(res.message);
      setFailed(!res.ok);
      if (!res.ok) setConfig(config);
      router.refresh();
    });
  }

  const enabledCount =
    config.lunch.filter(Boolean).length +
    config.dinner.filter(Boolean).length;

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
                {config[meal].filter(Boolean).length} days open
              </span>
            </span>
            {DAYS.map((d, i) => (
              <button
                key={d}
                className={`meal-cell${config[meal][i] ? ' on' : ''}`}
                onClick={() => toggle(meal, i)}
                disabled={pending}
                aria-label={`${meal} late plates on ${d}`}
              >
                {config[meal][i] ? '✓' : '—'}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="note">
        <strong className="mono">{enabledCount}</strong> meals active for late plate requests.
        Disabled days will not accept late plate requests and are hidden from the brother request screen.
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
