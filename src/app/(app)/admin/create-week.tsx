'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { adminCreateWeek } from '../../actions/week-admin-actions.ts';
import type { Meal, MealDayConfig } from '../../../lib/types.ts';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CreateWeekButton({
  suggested,
  suggestedLabel,
  existing,
}: {
  suggested: string;
  suggestedLabel: string;
  existing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(suggested);
  const [mealDays, setMealDays] = useState<MealDayConfig>({
    lunch: [true, true, true, true, true, false, true],
    dinner: [true, true, true, true, true, true, true],
  });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const clash = existing.includes(date);
  const isMonday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

  function toggleMeal(idx: number, meal: Meal) {
    setMealDays((prev: MealDayConfig) => {
      const nextList = [...prev[meal]];
      nextList[idx] = !nextList[idx];
      return {
        ...prev,
        [meal]: nextList,
      };
    });
  }

  function create() {
    startTransition(async () => {
      const res = await adminCreateWeek(date, undefined, mealDays);
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div>
        <button className="btn gold" onClick={() => setOpen(true)}>
          Create a week
        </button>
        {message && (
          <div
            className="note"
            style={failed ? { color: 'var(--red-600)' } : undefined}
          >
            {message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="create-week">
      <div className="create-week-head">
        <span className="create-week-title">Which week?</span>
        <span className="create-week-sub">
          Weeks run Monday to Sunday. The next one you have not made yet is{' '}
          {suggestedLabel}.
        </span>
      </div>

      <div className="create-week-row">
        <input
          className="field"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          className="btn gold"
          onClick={create}
          disabled={pending || clash || !isMonday}
        >
          {pending && <span className="spinner" />}
          {pending ? 'Drawing…' : 'Draw it and post it'}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <div className="create-week-days-config" style={{ marginTop: 14 }}>
        <div
          className="note"
          style={{ marginBottom: 10, fontWeight: 600, fontSize: 13 }}
        >
          Active Kitchen Service Days & Meals for this week:
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 10,
          }}
        >
          {DAYS.map((dayName, idx) => (
            <div
              key={dayName}
              style={{
                background: 'var(--navy-50)',
                border: '1px solid var(--navy-100)',
                borderRadius: 8,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: 'var(--gold-500)',
                  borderBottom: '1px solid var(--line)',
                  paddingBottom: 4,
                }}
              >
                {dayName}
              </span>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={mealDays.lunch[idx]}
                  onChange={() => toggleMeal(idx, 'lunch')}
                />
                ☀️ Lunch
              </label>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={mealDays.dinner[idx]}
                  onChange={() => toggleMeal(idx, 'dinner')}
                />
                🌙 Dinner
              </label>
            </div>
          ))}
        </div>
      </div>

      {!isMonday && (
        <div className="note" style={{ color: 'var(--amber-600)', marginTop: 8 }}>
          Pick a Monday — a week runs Monday through Sunday.
        </div>
      )}
      {clash && (
        <div className="note" style={{ color: 'var(--red-600)', marginTop: 8 }}>
          That week already exists. Delete it first if you want to draw it again.
        </div>
      )}

      {message && (
        <div
          className="note"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </div>
      )}
    </div>
  );
}
