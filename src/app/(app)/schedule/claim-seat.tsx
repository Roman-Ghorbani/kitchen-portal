'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { takeOpenSeat } from '../../actions/shift-actions.ts';
import { formatPoints } from '../../../lib/types.ts';

export function ClaimSeatButton({
  slotId,
  bounty,
  dayIndex,
  myMemberInfo,
}: {
  slotId: string;
  bounty: number;
  dayIndex: number;
  myMemberInfo?: { isExempt: boolean; standingConflicts: number[] } | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const isExempt = myMemberInfo?.isExempt ?? false;
  const hasConflict = myMemberInfo?.standingConflicts?.includes(dayIndex) ?? false;
  const needsWarning = isExempt || hasConflict;

  function executeClaim() {
    setShowConfirm(false);
    startTransition(async () => {
      const res = await takeOpenSeat(slotId);
      setMessage(res.message);
      setFailed(!res.ok);
      router.refresh();
    });
  }

  function handleBtnClick() {
    if (needsWarning) {
      setShowConfirm(true);
    } else {
      executeClaim();
    }
  }

  const warningReason =
    isExempt && hasConflict
      ? 'You are listed as Exempt and have a standing availability conflict for this day.'
      : isExempt
        ? 'You are listed as Exempt on the active roster.'
        : 'You set a standing availability conflict for this weekday.';

  return (
    <>
      <button className="btn gold sm" onClick={handleBtnClick} disabled={pending}>
        {pending && <span className="spinner" />}
        {pending
          ? 'Claiming…'
          : bounty > 1
            ? `Take it — ${formatPoints(bounty)}× points`
            : 'Take it — 1 point'}
      </button>

      {showConfirm && (
        <div className="claim-confirm-modal-overlay">
          <div className="claim-confirm-modal card card-pad">
            <div className="confirm-header">
              <span className="warning-icon">⚠️</span>
              <strong>Confirm Shift Claim</strong>
            </div>
            <div className="confirm-body">
              <p>{warningReason}</p>
              <p>Are you sure you want to claim this shift for {formatPoints(bounty)}× points?</p>
            </div>
            <div className="confirm-actions">
              <button
                className="btn gold sm"
                onClick={executeClaim}
                disabled={pending}
              >
                {pending ? 'Claiming…' : 'Yes, Claim Shift'}
              </button>
              <button
                className="btn sm"
                onClick={() => setShowConfirm(false)}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
