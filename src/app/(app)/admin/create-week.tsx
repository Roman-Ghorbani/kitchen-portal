'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { adminCreateWeek } from '../../actions/week-admin-actions.ts';

/**
 * Draws and posts a week, on a date the manager picks.
 *
 * Replaces a button labelled "Run Sunday chapter" that silently did four
 * different things. Creating a week and locking one are separate decisions
 * made at different moments, so they are separate controls that say what they
 * do.
 */
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
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const clash = existing.includes(date);
  const isMonday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

  function create() {
    startTransition(async () => {
      const res = await adminCreateWeek(date);
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

      {!isMonday && (
        <div className="note" style={{ color: 'var(--amber-600)' }}>
          Pick a Monday — a week runs Monday through Sunday.
        </div>
      )}
      {clash && (
        <div className="note" style={{ color: 'var(--red-600)' }}>
          That week already exists. Delete it first if you want to draw it again.
        </div>
      )}
      {!clash && isMonday && (
        <div className="note">
          Posting it puts it in front of the house straight away. Everyone on it
          gets their point immediately, and loses it only if they do not show.
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
