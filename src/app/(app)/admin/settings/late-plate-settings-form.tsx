'use client';

import { useState, useTransition } from 'react';
import { updateLatePlateSettings } from '../../../actions/settings-actions.ts';

export function LatePlateSettingsForm({
  defaultMessage,
  defaultLogo,
}: {
  defaultMessage: string | null;
  defaultLogo: string | null;
}) {
  const [message, setMessage] = useState(defaultMessage ?? '');
  const [logo, setLogo] = useState(defaultLogo ?? '');
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateLatePlateSettings(message, logo);
      setStatus({ ok: res.ok, msg: res.message });
      if (res.ok) {
        setTimeout(() => setStatus(null), 3000);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label className="field-label">Custom Banner Message</label>
        <div style={{ fontSize: 13, color: 'var(--ink-400)', marginBottom: 8 }}>
          If set, this message will appear prominently at the top of the brothers' late plate dashboard. Use this for special announcements or temporary rule changes.
        </div>
        <textarea
          className="field"
          style={{ width: '100%', minHeight: 60 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Kitchen closes at 6:30 today for a special event."
        />
      </div>

      <div>
        <label className="field-label">Custom Logo URL</label>
        <div style={{ fontSize: 13, color: 'var(--ink-400)', marginBottom: 8 }}>
          Provide an image URL (e.g. your ZBT crest) to display on the dashboard hero.
        </div>
        <input
          className="field"
          style={{ width: '100%' }}
          type="url"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          placeholder="https://example.com/logo.png"
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" className="btn sm gold" disabled={pending}>
          {pending ? 'Saving...' : 'Save Appearance Settings'}
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
