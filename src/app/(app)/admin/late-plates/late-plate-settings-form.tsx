'use client';

import { useState, useTransition } from 'react';
import { updateLatePlateBanner } from '../../../actions/settings-actions.ts';

export function LatePlateSettingsForm({ defaultMessage }: { defaultMessage: string | null }) {
  const [message, setMessage] = useState(defaultMessage ?? '');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateLatePlateBanner(message);
      setStatus({ ok: res.ok, msg: res.message });
      if (res.ok) {
        setTimeout(() => setStatus(null), 3000);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label className="field-label">Banner for the house</label>
        <div style={{ fontSize: 13, color: 'var(--ink-400)', marginBottom: 8 }}>
          Shown across the top of the brothers' Menu tab while it is set. Leave it empty to hide it.
        </div>
        <textarea
          className="field"
          style={{ width: '100%', minHeight: 60 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Kitchen closes at 6:30 today for a special event."
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" className="btn sm gold" disabled={pending}>
          {pending ? 'Saving…' : 'Save banner'}
        </button>
        {status && (
          <span style={{ fontSize: 13, color: status.ok ? '#10b981' : '#f87171' }}>
            {status.msg}
          </span>
        )}
      </div>
    </form>
  );
}
