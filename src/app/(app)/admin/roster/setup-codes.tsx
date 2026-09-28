'use client';

import { useState } from 'react';

import type { IssuedCode } from '../../../actions/auth-actions.ts';

const expiry = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Shows freshly issued setup codes. They exist only in this response - the
 * server keeps hashes - so the card makes copying (one message per brother,
 * for a DM) and printing (a sheet to hand out at chapter) the obvious next step.
 */
export function SetupCodes({ codes, onDone }: { codes: IssuedCode[]; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const messageFor = (c: IssuedCode) =>
    `Kitchen Portal setup code for ${c.name}: ${c.code}\n` +
    `Sign in at ${origin}/signin, pick your name, enter the code and choose a 6-digit PIN. ` +
    `It works once and expires ${expiry(c.expiresAt)}.`;

  function copy(key: string, text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (codes.length === 0) return null;

  return (
    <div className="setup-codes">
      <div className="setup-codes-head">
        <strong>
          {codes.length === 1 ? 'Setup code' : `${codes.length} setup codes`} — shown once
        </strong>
        <div className="setup-codes-actions">
          {codes.length > 1 && (
            <button
              className="btn sm"
              onClick={() => copy('all', codes.map((c) => `${c.name}\t${c.code}`).join('\n'))}
            >
              {copied === 'all' ? 'Copied' : 'Copy list'}
            </button>
          )}
          <button className="btn sm" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn sm alt" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
      <table className="compact-table setup-codes-table">
        <tbody>
          {codes.map((c) => (
            <tr key={c.memberId}>
              <td>{c.name}</td>
              <td className="mono setup-code">{c.code}</td>
              <td className="settings-hint">expires {expiry(c.expiresAt)}</td>
              <td className="row-actions">
                <button className="btn sm" onClick={() => copy(c.memberId, messageFor(c))}>
                  {copied === c.memberId ? 'Copied' : 'Copy message'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
