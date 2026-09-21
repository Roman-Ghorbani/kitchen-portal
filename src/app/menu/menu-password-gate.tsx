'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { submitMenuPassword } from '../actions/menu-auth-actions.ts';

export function MenuPasswordGate({
  initialLocked = false,
  initialRetryAfterMs = 0,
}: {
  initialLocked?: boolean;
  initialRetryAfterMs?: number;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockoutMs, setLockoutMs] = useState<number>(initialRetryAfterMs);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (lockoutMs <= 0) return;
    const interval = setInterval(() => {
      setLockoutMs((prev) => {
        if (prev <= 1000) {
          clearInterval(interval);
          setError(null);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutMs]);

  function formatRemainingTime(ms: number): string {
    const totalSecs = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || lockoutMs > 0) return;

    setError(null);
    startTransition(async () => {
      const res = await submitMenuPassword(password);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? 'Incorrect password');
        if (res.locked && res.retryAfterMs) {
          setLockoutMs(res.retryAfterMs);
        }
      }
    });
  }

  const isLocked = lockoutMs > 0;

  return (
    <div className="menu-gate-container">
      <div className="menu-gate-card">
        <div className="menu-gate-brand">
          <div className="brand-mark">ZBT</div>
          <div className="menu-gate-title">Kitchen Menu</div>
        </div>

        {error && (
          <div className={`alert ${isLocked ? 'bad' : 'warn'}`} style={{ marginBottom: 16 }}>
            <span className="alert-title">{isLocked ? '🔒 Access Temporarily Blocked' : 'Access Denied'}</span>
            <span className="alert-body">
              {error}
              {isLocked && (
                <div style={{ marginTop: 6, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  Unlocks in: {formatRemainingTime(lockoutMs)}
                </div>
              )}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="menu-gate-form">
          <div className="field-group">
            <label htmlFor="menu-pw" className="visually-hidden">
              Menu Password
            </label>
            <input
              id="menu-pw"
              type="password"
              className="field"
              placeholder="Enter menu password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending || isLocked}
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
            disabled={pending || isLocked || !password.trim()}
          >
            {pending ? 'Verifying...' : isLocked ? `Locked (${formatRemainingTime(lockoutMs)})` : 'Unlock Menu'}
          </button>
        </form>
      </div>
    </div>
  );
}
