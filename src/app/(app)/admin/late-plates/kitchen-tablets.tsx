'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { startTabletPairing, revokeTablet, retireLegacyLink } from '../../../actions/kiosk-actions.ts';

export interface TabletRow {
  id: string;
  label: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  pairingExpiresAt: string | null;
}

function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Everything about the chef tablets in one place: which are paired and when
 * each was last seen, pairing a new one, revoking one, and opening the same
 * screen the chefs see.
 */
export function KitchenTablets({
  tablets,
  legacyLinkActive,
}: {
  tablets: TabletRow[];
  legacyLinkActive: boolean;
}) {
  const [label, setLabel] = useState('Kitchen tablet');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [origin, setOrigin] = useState('');
  const router = useRouter();

  useEffect(() => {
    setOrigin(window.location.origin);
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMessage({ ok: res.ok, text: res.message });
      router.refresh();
    });
  }

  const paired = tablets.filter((t) => t.pairedAt);
  const online = paired.some((t) => t.lastSeenAt && now - Date.parse(t.lastSeenAt) < 5 * 60_000);
  const minutesLeft = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 60_000)) : 0;

  return (
    <section className="card card-pad settings-card">
      <div className="card-head-row">
        <div>
          <h2 className="section-title">Kitchen tablet</h2>
          <p className="settings-lede">
            {paired.length === 0
              ? 'No tablet is paired. The chefs cannot see the queue until one is.'
              : online
                ? 'The kitchen screen is online.'
                : 'No tablet has checked in for five minutes. It may be off or asleep.'}
          </p>
        </div>
        <a className="btn sm" href="/kitchen/late-plates" target="_blank" rel="noopener">
          Open kiosk view ↗
        </a>
      </div>

      {paired.length > 0 && (
        <table className="compact-table">
          <thead>
            <tr>
              <th>Tablet</th>
              <th>Paired</th>
              <th>Last seen</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {paired.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>{ago(t.pairedAt, now)}</td>
                <td>{ago(t.lastSeenAt, now)}</td>
                <td className="row-actions">
                  <button
                    className="btn sm alt"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Revoke "${t.label}"? It will need to be paired again.`)) {
                        run(() => revokeTablet(t.id));
                      }
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pairing && minutesLeft > 0 ? (
        <div className="pairing-box">
          <div className="pairing-code mono">{pairing.code}</div>
          <p>
            On the tablet, open <strong className="mono">{origin}/kitchen/pair</strong> and
            enter this code. It works once and expires in {minutesLeft} minute
            {minutesLeft === 1 ? '' : 's'}.
          </p>
          <button className="btn sm alt" onClick={() => setPairing(null)}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="settings-inline"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await startTabletPairing(label);
              if (res.code && res.expiresAt) setPairing({ code: res.code, expiresAt: res.expiresAt });
              setMessage(null);
              router.refresh();
            });
          }}
        >
          <input
            className="field"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Name for the tablet"
          />
          <button className="btn sm" type="submit" disabled={pending}>
            Pair a tablet
          </button>
        </form>
      )}

      {legacyLinkActive && (
        <div className="note warn">
          The old bookmarked link (<span className="mono">?device=…</span>) still works. A
          tablet that opens it is converted to a paired device automatically. Once the
          kitchen tablet appears above, retire the old link.{' '}
          <button className="linkish" disabled={pending} onClick={() => run(retireLegacyLink)}>
            Retire old link
          </button>
        </div>
      )}

      {message && <div className={message.ok ? 'form-msg ok' : 'form-msg bad'}>{message.text}</div>}
    </section>
  );
}
