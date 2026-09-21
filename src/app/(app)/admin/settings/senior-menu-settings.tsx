'use client';

import { useState, useTransition, useEffect } from 'react';
import { updateSeniorMenuPassword } from '../../../actions/menu-auth-actions.ts';

export function SeniorMenuSettings({ initialPassword }: { initialPassword?: string }) {
  const [password, setPassword] = useState(initialPassword || '');
  const [savedPassword, setSavedPassword] = useState(initialPassword || '');
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [menuUrl, setMenuUrl] = useState('https://kitchen.zbtaa.online/menu');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setMenuUrl(`${window.location.origin}/menu`);
    }
  }, []);

  function handleCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(menuUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || password === savedPassword) return;

    setStatusMsg(null);
    setIsError(false);

    startTransition(async () => {
      const res = await updateSeniorMenuPassword(password);
      if (res.ok) {
        setSavedPassword(password);
        setStatusMsg('Password updated.');
        setIsError(false);
      } else {
        setStatusMsg(res.message);
        setIsError(true);
      }
      setTimeout(() => setStatusMsg(null), 3000);
    });
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Out-of-House Senior Menu
      </h2>
      <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 0 }}>
        Shareable weekly menu for out-of-house seniors and alumni. Protected by a simple global password that automatically remembers each device forever.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <div className="senior-link-row">
          <input
            className="field"
            readOnly
            value={menuUrl}
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            type="button"
            className={`btn ${copied ? 'gold' : ''}`}
            onClick={handleCopy}
            style={{ flexShrink: 0 }}
          >
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 240 }}>
            <label htmlFor="senior-pw-field" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-600)', whiteSpace: 'nowrap' }}>
              Access Password:
            </label>
            <input
              id="senior-pw-field"
              type="text"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="e.g. zbt2026"
              style={{ flex: 1 }}
              disabled={pending}
            />
          </div>

          <button
            type="submit"
            className="btn sm"
            disabled={pending || password === savedPassword || !password.trim()}
          >
            {pending ? 'Saving...' : 'Update Password'}
          </button>
        </form>

        {statusMsg && (
          <div style={{ fontSize: 12, fontWeight: 600, color: isError ? 'var(--red-600)' : 'var(--green-600)' }}>
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}
