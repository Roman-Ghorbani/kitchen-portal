'use client';

import { useState, useMemo, useTransition } from 'react';

import { signInBrother, signInAdmin, enrollBrother } from '../actions/auth-actions.ts';

export interface PickerMember {
  id: string;
  name: string;
  rotation: 'lunch' | 'dinner';
  hasPin: boolean;
}

const PIN_LENGTH = 6;

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

export function SignInForm({
  roster,
  totpEnabled,
}: {
  roster: PickerMember[];
  totpEnabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickerMember | null>(null);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [pending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((m) => m.name.toLowerCase().includes(q));
  }, [query, roster]);

  function run(action: () => Promise<{ ok: boolean; error?: string } | undefined>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res && !res.ok) setError(res.error ?? 'Sign-in failed.');
    });
  }

  function back() {
    setPicked(null);
    setAdminMode(false);
    setPin('');
    setCode('');
    setConfirmPin('');
    setPassword('');
    setTotp('');
    setError(null);
  }

  /* ---------------- kitchen manager ---------------- */

  if (adminMode) {
    const ready = password.length > 0 && (!totpEnabled || totp.length === 6);
    return (
      <form
        className="signin-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) run(() => signInAdmin(password, totp));
        }}
      >
        <h2>Kitchen manager</h2>
        <p className="hint">
          Roster, weeks, points and the audit log.
          {totpEnabled && ' Enter the six-digit code from your authenticator app.'}
        </p>

        <div style={{ position: 'relative', width: '100%' }}>
          <input
            className="field"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            autoFocus
            style={{ paddingRight: '4rem' }}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute',
              right: '0.8rem',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: 'var(--ink-3)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>

        {totpEnabled && (
          <input
            className="field pin"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Authenticator code"
            value={totp}
            onChange={(e) => setTotp(digits(e.target.value, 6))}
          />
        )}

        {error && <div className="error" role="alert">{error}</div>}

        <button className="btn primary wide" type="submit" disabled={pending || !ready}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="linkish" type="button" onClick={back}>
          ← Back to the roster
        </button>
      </form>
    );
  }

  /* ---------------- first sign-in: setup code + new PIN ---------------- */

  if (picked && !picked.hasPin) {
    const mismatch = confirmPin.length === PIN_LENGTH && confirmPin !== pin;
    const ready = code.replace(/[^0-9A-Za-z]/g, '').length === 8 && pin.length === PIN_LENGTH && pin === confirmPin;
    return (
      <form
        className="signin-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) run(() => enrollBrother(picked.id, code, pin));
        }}
      >
        <PickedHeader member={picked} />

        <h2>Set up your account</h2>
        <p className="hint">
          Enter the setup code the kitchen manager gave you, then choose a{' '}
          {PIN_LENGTH}-digit PIN. The code works once. No code? Ask the kitchen
          manager for one.
        </p>

        <input
          className="field mono"
          placeholder="Setup code, e.g. K7QM-3XWD"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))}
        />
        <input
          className="field pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          placeholder={`New ${PIN_LENGTH}-digit PIN`}
          value={pin}
          onChange={(e) => setPin(digits(e.target.value, PIN_LENGTH))}
        />
        <input
          className="field pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirmPin}
          onChange={(e) => setConfirmPin(digits(e.target.value, PIN_LENGTH))}
        />

        {mismatch && <div className="error">The two PINs do not match.</div>}
        {error && <div className="error" role="alert">{error}</div>}

        <button className="btn primary wide" type="submit" disabled={pending || !ready}>
          {pending ? 'Setting up…' : 'Set PIN and continue'}
        </button>
        <button className="linkish" type="button" onClick={back}>
          ← Not you?
        </button>
      </form>
    );
  }

  /* ---------------- returning brother ---------------- */

  if (picked) {
    const ready = pin.length === 4 || pin.length === PIN_LENGTH;
    return (
      <form
        className="signin-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) run(() => signInBrother(picked.id, pin));
        }}
      >
        <PickedHeader member={picked} />

        <h2>Enter your PIN</h2>
        <p className="hint">
          Forgot it? The kitchen manager can reset it and give you a new setup code.
        </p>

        <input
          className="field pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="••••••"
          value={pin}
          autoFocus
          onChange={(e) => setPin(digits(e.target.value, PIN_LENGTH))}
        />

        {error && <div className="error" role="alert">{error}</div>}

        <button className="btn primary wide" type="submit" disabled={pending || !ready}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="linkish" type="button" onClick={back}>
          ← Not you?
        </button>
      </form>
    );
  }

  /* ---------------- name picker ---------------- */

  return (
    <div className="signin-card">
      <h2>Find your name</h2>
      <p className="hint">
        {roster.length} brothers on the duty roster. First time here? You will
        need the setup code the kitchen manager gave you.
      </p>

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
            <span className={`tag ${m.rotation === 'lunch' ? 'jun' : 'soph'}`}>
              {m.rotation === 'lunch' ? 'Lunch' : 'Dinner'}
            </span>
            {!m.hasPin && <span className="tag ok">New</span>}
          </button>
        ))}

        {matches.length === 0 && (
          <div className="hint empty">
            No match. Check the spelling, or ask the kitchen manager if you
            should be on the roster.
          </div>
        )}
      </div>

      <button className="linkish" onClick={() => setAdminMode(true)}>
        I&apos;m the kitchen manager
      </button>
    </div>
  );
}

function PickedHeader({ member }: { member: PickerMember }) {
  return (
    <div className="picked">
      <span className="avatar me">{initials(member.name)}</span>
      <div>
        <div className="picked-name">{member.name}</div>
        <div className="hint">{member.rotation === 'lunch' ? 'Lunch crew' : 'Dinner crew'}</div>
      </div>
    </div>
  );
}
