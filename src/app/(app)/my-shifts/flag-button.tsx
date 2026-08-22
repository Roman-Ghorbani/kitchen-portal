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
        <button className="btn sm" onClick={() => setOpen(true)}>
          Flag a conflict
        </button>
      ) : (
        <div className="flag-form">
          <input
            className="field"
            placeholder="Reason (optional) — e.g. exam that night"
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className="flag-actions">
            <button className="btn sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary sm" onClick={submit} disabled={pending}>
              {pending ? 'Flagging…' : 'Flag it'}
            </button>
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            This opens your slot to the whole house. It does not cancel your
            obligation — if nobody picks it up, it goes to Roman to resolve.
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
