'use client';

import { useState, useTransition } from 'react';

import { changePin, signOutEverywhere } from '../actions/auth-actions.ts';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/**
 * A brother's own credentials: change his PIN (which also signs out every
 * other device) or sign out everywhere outright - the thing to do if he
 * thinks someone else has been using his account.
 */
export function AccountCard() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = current.length >= 4 && next.length === 6 && next === again;

  return (
    <section className="card card-pad account-card">
      <h2 className="section-title">Your account</h2>
      {!open ? (
        <div className="settings-inline">
          <button className="btn sm" onClick={() => setOpen(true)}>
            Change PIN
          </button>
          <form action={signOutEverywhere}>
            <button className="btn sm alt" type="submit">
              Sign out on every device
            </button>
          </form>
        </div>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await changePin(current, next);
              setStatus({ ok: res.ok, text: res.ok ? 'PIN changed. Your other devices are signed out.' : res.error ?? 'Could not change it.' });
              if (res.ok) {
                setOpen(false);
                setCurrent('');
                setNext('');
                setAgain('');
              }
            });
          }}
        >
          <input className="field pin" type="password" inputMode="numeric" autoComplete="current-password" placeholder="Current PIN" value={current} onChange={(e) => setCurrent(digits(e.target.value))} />
          <input className="field pin" type="password" inputMode="numeric" autoComplete="new-password" placeholder="New 6-digit PIN" value={next} onChange={(e) => setNext(digits(e.target.value))} />
          <input className="field pin" type="password" inputMode="numeric" autoComplete="new-password" placeholder="New PIN again" value={again} onChange={(e) => setAgain(digits(e.target.value))} />
          <div className="settings-inline">
            <button className="btn primary sm" type="submit" disabled={pending || !ready}>
              {pending ? 'Saving…' : 'Save new PIN'}
            </button>
            <button className="btn sm alt" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {status && <div className={status.ok ? 'form-msg ok' : 'form-msg bad'}>{status.text}</div>}
    </section>
  );
}
