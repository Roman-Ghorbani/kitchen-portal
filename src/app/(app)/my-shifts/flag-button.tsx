'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { flagMyShift } from '../../actions/shift-actions.ts';

export function FlagButton({
  assignmentId,
  disabled,
  disabledReason,
}: {
  assignmentId: string;
  disabled: boolean;
  disabledReason: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (disabled) {
    return (
      <span className="tag locked" title={disabledReason}>
        {disabledReason}
      </span>
    );
  }

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
          Report Conflict / Can&apos;t Make It
        </button>
      ) : (
        <div className="flag-form">
          <input
            className="field"
            placeholder="Reason why you can't make it (e.g. Midterm exam)"
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
              {pending ? 'Sending…' : 'Submit Conflict to Roman'}
            </button>
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            Submits your conflict message to Roman. Your shift is opened for replacement while Roman reviews it.
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
