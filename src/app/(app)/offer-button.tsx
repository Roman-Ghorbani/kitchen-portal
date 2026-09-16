'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { flagMyShift } from '../actions/shift-actions.ts';

/**
 * Puts your own shift up for grabs.
 *
 * Always available - there is no week lock and no deadline to be inside of.
 * The copy has one job: make it obvious that this posts the seat to the board
 * by itself and does not send a request to the kitchen manager for approval.
 */
export function OfferShiftButton({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const res = await flagMyShift(assignmentId, reason);
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flag-wrap">
      {!open ? (
        <button className="btn sm danger" onClick={() => setOpen(true)}>
          Put this up for grabs
        </button>
      ) : (
        <div className="flag-form">
          <input
            className="field"
            placeholder="Why, so the house knows (e.g. away game)"
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className="flag-actions" style={{ marginTop: 8 }}>
            <button className="btn sm" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn danger sm"
              type="button"
              onClick={submit}
              disabled={pending || !reason.trim()}
            >
              {pending && <span className="spinner" />}
              {pending ? 'Posting…' : 'Post it to the board'}
            </button>
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            Posts it straight to the board &mdash; anyone in the house can claim
            it themselves. Worth 1&times; unless the kitchen manager raises it.
            It stays yours until somebody takes it.
          </div>
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
