'use client';

import { useState, useMemo, useTransition } from 'react';

import { signInBrother, signInAdmin } from '../actions/auth-actions.ts';

export interface PickerMember {
  id: string;
  name: string;
  classYear: 'junior' | 'sophomore';
  hasPin: boolean;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function SignInForm({ roster }: { roster: PickerMember[] }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickerMember | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [password, setPassword] = useState('');
  const [pending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster.slice(0, 8);
    return roster.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 12);
  }, [query, roster]);

  function submitPin() {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const res = await signInBrother(picked.id, pin);
      if (res && !res.ok) setError(res.error ?? 'Sign-in failed.');
    });
  }

  function submitAdmin() {
    setError(null);
    startTransition(async () => {
      const res = await signInAdmin(password);
      if (res && !res.ok) setError(res.error ?? 'Sign-in failed.');
    });
  }

  /* ---------------- admin ---------------- */

  if (adminMode) {
    return (
      <div className="signin-card">
        <h2>Kitchen Manager</h2>
        <p className="hint">Admin access to the roster, points, and approvals.</p>

        <input
          className="field"
          type="password"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitAdmin()}
        />

        {error && <div className="error">{error}</div>}

        <button
          className="btn primary wide"
          onClick={submitAdmin}
          disabled={pending || !password}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          className="linkish"
          onClick={() => {
            setAdminMode(false);
            setError(null);
          }}
        >
          ← Back to the roster
        </button>
      </div>
    );
  }

  /* ---------------- PIN step ---------------- */

  if (picked) {
    const firstTime = !picked.hasPin;
    return (
      <div className="signin-card">
        <div className="picked">
          <span className="avatar me">{initials(picked.name)}</span>
          <div>
            <div className="picked-name">{picked.name}</div>
            <div className="hint">
              {picked.classYear === 'junior' ? 'Lunch duty' : 'Dinner duty'}
            </div>
          </div>
        </div>

        <h2>{firstTime ? 'Choose a 4-digit PIN' : 'Enter your PIN'}</h2>
        <p className="hint">
          {firstTime
            ? "You'll use this every time you sign in. It keeps anyone else from flagging or covering shifts as you."
            : 'Forgot it? Ask Roman to reset it for you.'}
        </p>

        <input
          className="field pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="••••"
          value={pin}
          autoFocus
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && pin.length === 4 && submitPin()}
        />

        {error && <div className="error">{error}</div>}

        <button
          className="btn primary wide"
          onClick={submitPin}
          disabled={pending || pin.length !== 4}
        >
          {pending ? 'Signing in…' : firstTime ? 'Set PIN and continue' : 'Sign in'}
        </button>

        <button
          className="linkish"
          onClick={() => {
            setPicked(null);
            setPin('');
            setError(null);
          }}
        >
          ← Not you?
        </button>
      </div>
    );
  }

  /* ---------------- name picker ---------------- */

  return (
    <div className="signin-card">
      <div className="onboarding-banner">
        <div className="banner-title">How Kitchen Duty Works</div>
        <div className="banner-steps">
          <div className="step-item">
            <span className="step-num">1</span>
            <span>Select your name & set a 4-digit PIN</span>
          </div>
          <div className="step-item">
            <span className="step-num">2</span>
            <span>View your assigned lunch or dinner shifts</span>
          </div>
          <div className="step-item">
            <span className="step-num">3</span>
            <span>Flag conflicts before Sunday or cover open shifts</span>
          </div>
        </div>
      </div>

      <h2>Find your name</h2>
      <p className="hint">{roster.length} brothers on the duty roster.</p>

      <input
        className="field"
        placeholder="Start typing your name…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="picker-list">
        {matches.map((m) => (
          <button key={m.id} className="picker-row" onClick={() => setPicked(m)}>
            <span className="avatar">{initials(m.name)}</span>
            <span className="picker-name">{m.name}</span>
            <span className={`tag ${m.classYear === 'junior' ? 'jun' : 'soph'}`}>
              {m.classYear === 'junior' ? 'Lunch' : 'Dinner'}
            </span>
            {!m.hasPin && <span className="tag ok">New</span>}
          </button>
        ))}

        {matches.length === 0 && (
          <div className="hint empty">
            No match. Check the spelling, or ask Roman if you should be on the
            roster.
          </div>
        )}
      </div>

      <button className="linkish" onClick={() => setAdminMode(true)}>
        I&apos;m the kitchen manager
      </button>
    </div>
  );
}
