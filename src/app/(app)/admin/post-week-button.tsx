'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { postBootstrapWeek, postNextWeek } from '../../actions/week-actions.ts';

export function PostWeekButton({
  weekStart,
  isBootstrap,
  label,
}: {
  weekStart: string;
  isBootstrap: boolean;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  function run() {
    setMessage(null);
    startTransition(async () => {
      const res = isBootstrap
        ? await postBootstrapWeek(weekStart)
        : await postNextWeek(weekStart);
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div>
      <button className="btn gold" onClick={run} disabled={pending}>
        {pending ? 'Generating…' : label}
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
