'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { adminCreateWeek } from '../../actions/week-admin-actions.ts';

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
  const [activeDays, setActiveDays] = useState<boolean[]>([
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const clash = existing.includes(date);
  const isMonday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

  function toggleDay(idx: number) {
    const next = [...activeDays];
    next[idx] = !next[idx];
    setActiveDays(next);
  }

  function create() {
    const disabledDays = activeDays
      .map((active, idx) => (active ? null : idx))
      .filter((x): x is number => x !== null);

    startTransition(async () => {
      const res = await adminCreateWeek(date, disabledDays);
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

      <div className="create-week-days-config" style={{ marginTop: 12 }}>
        <div className="note" style={{ marginBottom: 6, fontWeight: 600 }}>
          Active Kitchen Service Days for this week:
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {DAYS.map((dayName, idx) => (
            <label
              key={dayName}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 13,
                cursor: 'pointer',
                userSelect: 'none',
                background: activeDays[idx] ? 'rgba(217, 178, 105, 0.15)' : 'var(--card)',
                border:
                  '1px solid ' +
                  (activeDays[idx] ? 'var(--gold-500)' : 'var(--line)'),
                padding: '4px 8px',
                borderRadius: 6,
              }}
            >
              <input
                type="checkbox"
                checked={activeDays[idx]}
                onChange={() => toggleDay(idx)}
              />
              {dayName}
            </label>
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
