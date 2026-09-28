'use client';

import { useState, useTransition } from 'react';

import { pairTablet } from '../../actions/kiosk-actions.ts';

export function PairForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = code.replace(/[^0-9A-Za-z]/g, '').length === 8;

  return (
    <form
      className="kq-pair-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await pairTablet(code);
          if (res && !res.ok) setError(res.error ?? 'Pairing failed.');
        });
      }}
    >
      <input
        className="kq-pair-input"
        placeholder="XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))}
      />
      <button className="kq-pair-button" type="submit" disabled={!ready || pending}>
        {pending ? 'Pairing…' : 'Pair tablet'}
      </button>
      {error && (
        <p className="kq-pair-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
