'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { markAttendance, placeSubstitute } from '../../../actions/shift-actions.ts';

export interface RosterOption {
  id: string;
  name: string;
}

export function AttendanceControls({
  assignmentId,
  status,
  roster,
  currentSub,
  multiplier,
}: {
  assignmentId: string;
  status: string;
  roster: RosterOption[];
  currentSub: string | null;
  multiplier: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bounty, setBounty] = useState(1);
  const router = useRouter();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return roster.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, roster]);

  function mark(next: 'assigned' | 'no-show' | 'excused') {
    startTransition(async () => {
      const res = await markAttendance(assignmentId, next);
      setMessage(res.message);
      setFailed(!res.ok);
      router.refresh();
    });
  }

  function sub(memberId: string) {
    startTransition(async () => {
      const res = await placeSubstitute(assignmentId, memberId, bounty);
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) {
        setSubOpen(false);
        setQuery('');
        setBounty(1);
      }
      router.refresh();
    });
  }

  return (
    <div className="att-controls">
      <div className="att-buttons">
        <button
          className={`btn sm${status === 'no-show' ? ' danger-on' : ''}`}
          onClick={() => mark('no-show')}
          disabled={pending}
        >
          No-show
        </button>
        <button
          className={`btn sm${status === 'excused' ? ' excused-on' : ''}`}
          onClick={() => mark('excused')}
          disabled={pending}
        >
          Excuse
        </button>
        {status !== 'assigned' && (
          <button className="btn sm" onClick={() => mark('assigned')} disabled={pending}>
            Undo
          </button>
        )}
        <button className="btn sm" onClick={() => setSubOpen((v) => !v)}>
          {currentSub ? 'Change sub' : 'Add sub'}
        </button>
      </div>

      {subOpen && (
        <div className="sub-panel">
          <div className="bounty-row">
            <span className="bounty-label">Award</span>
            {[1, 2, 3].map((m) => (
              <button
                key={m}
                className={`btn sm${bounty === m ? ' gold' : ''}`}
                onClick={() => setBounty(m)}
              >
                {m}x
              </button>
            ))}
            <span className="bounty-hint">
              {bounty === 1
                ? 'Normal credit'
                : `Bounty — ${bounty} points for stepping up`}
            </span>
          </div>

          <input
            className="field"
            placeholder="Who is covering? Type a name…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />

          {matches.length > 0 && (
            <div className="sub-list">
              {matches.map((m) => (
                <button
                  key={m.id}
                  className="picker-row"
                  onClick={() => sub(m.id)}
                  disabled={pending}
                >
                  <span className="picker-name">{m.name}</span>
                  <span className="tag ok">{bounty}x</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {multiplier > 1 && (
        <span className="tag ok">Earning {multiplier}x</span>
      )}

      {message && (
        <div
          className="att-msg"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </div>
      )}
    </div>
  );
}
