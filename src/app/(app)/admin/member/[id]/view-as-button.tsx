'use client';

import { useTransition } from 'react';

import { viewAsMember } from '../../../../actions/preview-actions.ts';

/**
 * Opens the app as this brother sees it. Read-only, and it times out on its
 * own after an hour so the manager cannot forget he is inside somebody's
 * account and then wonder why the dashboard looks wrong.
 */
export function ViewAsButton({ memberId, name }: { memberId: string; name: string }) {
  const [pending, start] = useTransition();

  return (
    <button
      className="btn sm"
      disabled={pending}
      onClick={() => start(() => viewAsMember(memberId))}
      title={`See the app as ${name} sees it`}
    >
      {pending && <span className="spinner" />}
      {pending ? 'Opening…' : 'See his app →'}
    </button>
  );
}
