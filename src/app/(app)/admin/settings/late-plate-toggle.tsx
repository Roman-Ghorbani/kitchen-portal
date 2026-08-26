'use client';

import { useState, useTransition } from 'react';
import { toggleLatePlates } from '../../../actions/settings-actions.ts';

export function LatePlateToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    const prev = enabled;
    setEnabled(next);
    setMessage(null);

    startTransition(async () => {
      const res = await toggleLatePlates(next);
      if (!res.ok) {
        setEnabled(prev);
        setFailed(true);
        setMessage(res.message);
      } else {
        setFailed(false);
        setMessage(res.message);
      }
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-900)' }}>
            Allow brother requests
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 2 }}>
            {enabled
              ? 'Active: Brothers can submit and manage late plates on their page.'
              : 'Paused: Brothers can see the page to preview the layout, but requesting is greyed out.'}
          </div>
        </div>

        <button
          type="button"
          className={`btn sm ${enabled ? 'good' : 'ghost'}`}
          disabled={pending}
          onClick={() => onToggle(!enabled)}
          style={{ minWidth: 110 }}
        >
          {pending ? (
            <span className="spinner" />
          ) : enabled ? (
            '✓ Enabled'
          ) : (
            'Paused'
          )}
        </button>
      </div>

      {message && (
        <div
          className="note"
          style={{
            marginTop: 12,
            color: failed ? 'var(--red-600)' : 'var(--ink-600)',
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
