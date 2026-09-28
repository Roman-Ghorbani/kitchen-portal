'use client';

import { useEffect, useState, useTransition } from 'react';

import { updateSeniorMenuPassword } from '../../../actions/menu-auth-actions.ts';

const MIN_LENGTH = 8;

/**
 * The shareable weekly menu for out-of-house seniors and alumni.
 *
 * The current password is never shown - only whether one is set - because it
 * is stored as a hash. Changing it signs every device out of the menu.
 */
export function SeniorMenuSettings({ passwordSet }: { passwordSet: boolean }) {
  const [password, setPassword] = useState('');
  const [menuUrl, setMenuUrl] = useState('/menu');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSet, setIsSet] = useState(passwordSet);
  const [pending, startTransition] = useTransition();

  useEffect(() => setMenuUrl(`${window.location.origin}/menu`), []);

  function copy() {
    void navigator.clipboard?.writeText(menuUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateSeniorMenuPassword(password);
      setStatus({ ok: res.ok, text: res.message });
      if (res.ok) {
        setPassword('');
        setIsSet(true);
      }
    });
  }

  return (
    <section className="card card-pad settings-card">
      <h2 className="section-title">Senior Week menu</h2>
      <p className="settings-lede">
        A read-only weekly menu for out-of-house seniors and alumni, behind one
        shared password.{' '}
        {isSet ? 'A password is set.' : 'No password is set yet, so the page is closed.'}
      </p>

      <div className="settings-inline">
        <input className="field mono" readOnly value={menuUrl} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <form className="settings-inline" onSubmit={save}>
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder={isSet ? 'New password' : 'Set a password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
        <button type="submit" className="btn sm" disabled={pending || password.trim().length < MIN_LENGTH}>
          {pending ? 'Saving…' : isSet ? 'Change password' : 'Set password'}
        </button>
      </form>
      <p className="settings-hint">
        At least {MIN_LENGTH} characters. Changing it signs everyone out of the menu.
      </p>

      {status && (
        <div className={status.ok ? 'form-msg ok' : 'form-msg bad'} role="status">
          {status.text}
        </div>
      )}
    </section>
  );
}
