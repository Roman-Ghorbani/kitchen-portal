'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMakeupDebt } from '../../../../actions/roster-actions.ts';

export function MemberDebtControls({
  memberId,
  currentDebt,
}: {
  memberId: string;
  currentDebt: number;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (currentDebt <= 0) return null;

  function clearDebt() {
    startTransition(async () => {
      await setMakeupDebt(memberId, 0);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="btn sm gold"
      disabled={pending}
      onClick={clearDebt}
      style={{ marginLeft: 8, fontSize: 11, padding: '3px 8px' }}
      title="Clear make-up debt for this member"
    >
      {pending ? 'Clearing...' : '✓ Clear make-up debt'}
    </button>
  );
}
