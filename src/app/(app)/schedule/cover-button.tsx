'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { coverShift } from '../../actions/shift-actions.ts';

export function CoverButton({
  assignmentId,
  label,
}: {
  assignmentId: string;
  label: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function claim() {
    startTransition(async () => {
      const res = await coverShift(assignmentId);
      setMessage(res.message);
      setFailed(!res.ok);
      router.refresh();
    });
  }

  return (
    <>
      <button className="btn gold sm" onClick={claim} disabled={pending}>
        {pending ? 'Claiming…' : label}
      </button>
      {message && (
        <span
          className="claim-msg"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </span>
      )}
    </>
  );
}
