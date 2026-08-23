'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { takeOpenSeat } from '../../actions/shift-actions.ts';

/**
 * Takes a seat nobody is assigned to.
 *
 * Distinct from picking up a flagged shift: there is no assignment to claim,
 * so this creates one. Without it a shift the scheduler could not fill, or one
 * the manager emptied, sat there unclaimable.
 */
export function ClaimSeatButton({
  slotId,
  bounty,
}: {
  slotId: string;
  bounty: number;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function claim() {
    startTransition(async () => {
      const res = await takeOpenSeat(slotId);
      setMessage(res.message);
      setFailed(!res.ok);
      router.refresh();
    });
  }

  return (
    <>
      <button className="btn gold sm" onClick={claim} disabled={pending}>
        {pending && <span className="spinner" />}
        {pending
          ? 'Claiming…'
          : bounty > 1
            ? `Take it — ${bounty}× points`
            : 'Take it'}
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
