'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import {
  setClassYear,
  setExempt,
  adjustPoints,
  setActive,
} from '../../../actions/roster-actions.ts';
import { resetMemberPin } from '../../../actions/auth-actions.ts';

export interface RosterRow {
  id: string;
  name: string;
  classYear: 'junior' | 'sophomore';
  points: number;
  makeupDebt: number;
  exempt: boolean;
  exemptReason: string | null;
  exemptNotes: string | null;
  hasPin: boolean;
  active: boolean;
  standingConflicts: number;
}

type Filter = 'all' | 'junior' | 'sophomore' | 'exempt' | 'no-pin' | 'owing';

const EXEMPT_REASONS = [
  { value: 'officer', label: 'House officer role' },
  { value: 'medical', label: 'Medical / health' },
  { value: 'off-campus', label: 'Off-campus' },
  { value: 'other', label: 'Other' },
] as const;

export function RosterTable({ rows }: { rows: RosterRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'junior': return r.classYear === 'junior';
        case 'sophomore': return r.classYear === 'sophomore';
        case 'exempt': return r.exempt;
        case 'no-pin': return !r.hasPin;
        case 'owing': return r.makeupDebt > 0;
        default: return true;
      }
    });
  }, [rows, query, filter]);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMessage(res.message);
      setFailed(!res.ok);
      router.refresh();
    });
  }

  const counts = {
    all: rows.length,
    junior: rows.filter((r) => r.classYear === 'junior').length,
    sophomore: rows.filter((r) => r.classYear === 'sophomore').length,
    exempt: rows.filter((r) => r.exempt).length,
    'no-pin': rows.filter((r) => !r.hasPin).length,
    owing: rows.filter((r) => r.makeupDebt > 0).length,
  };

  return (
    <>
      <div className="roster-toolbar">
        <input
          className="field"
          placeholder="Search the roster…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-chips">
          {(Object.keys(counts) as Filter[]).map((f) => (
            <button
              key={f}
              className={`filter-chip${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' :
               f === 'no-pin' ? 'No PIN' :
               f === 'owing' ? 'Owes make-up' :
               f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="chip-count mono">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div
          className="note"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </div>
      )}

      <div className="roster-list">
        {shown.map((r) => (
          <div key={r.id} className={`roster-row${r.exempt ? ' is-exempt' : ''}${!r.active ? ' inactive' : ''}`}>
            <button
              className="roster-main"
              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            >
              <span className="roster-name">{r.name}</span>

              <span className={`tag ${r.classYear === 'junior' ? 'jun' : 'soph'}`}>
                {r.classYear === 'junior' ? 'Lunch' : 'Dinner'}
              </span>

              <span className="roster-pts mono" title="Kitchen points">
                {r.points}
              </span>

              {r.makeupDebt > 0 && (
                <span className="tag bad">owes {r.makeupDebt}</span>
              )}
              {r.exempt && <span className="tag locked">exempt</span>}
              {!r.hasPin && <span className="tag ok">no PIN</span>}
              {r.standingConflicts > 0 && (
                <span className="tag locked">
                  {r.standingConflicts} conflict{r.standingConflicts === 1 ? '' : 's'}
                </span>
              )}
              {!r.active && <span className="tag bad">off roster</span>}
            </button>

            {expanded === r.id && (
              <div className="roster-detail">
                <div className="detail-group">
                  <span className="detail-label">Record</span>
                  <div className="detail-actions">
                    <Link className="btn sm primary" href={`/admin/member/${r.id}`}>
                      See everything on {r.name.split(' ')[0]}
                    </Link>
                  </div>
                  <div className="detail-hint">
                    Every shift, how much notice they had, what they flagged,
                    and every correction — the answer to any dispute.
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Duty year</span>
                  <div className="detail-actions">
                    {(['junior', 'sophomore'] as const).map((y) => (
                      <button
                        key={y}
                        className={`btn sm${r.classYear === y ? ' primary' : ''}`}
                        disabled={pending}
                        onClick={() => run(() => setClassYear(r.id, y))}
                      >
                        {y === 'junior' ? 'Junior · lunch' : 'Sophomore · dinner'}
                      </button>
                    ))}
                  </div>
                  <div className="detail-hint">
                    For brothers who rushed late and are a year off from the rest
                    of their pledge class.
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Points</span>
                  <div className="detail-actions">
                    <button className="btn sm" disabled={pending}
                      onClick={() => run(() => adjustPoints(r.id, -1))}>−1</button>
                    <span className="roster-pts mono">{r.points}</span>
                    <button className="btn sm" disabled={pending}
                      onClick={() => run(() => adjustPoints(r.id, 1))}>+1</button>
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Exemption</span>
                  <div className="detail-actions">
                    {r.exempt ? (
                      <button className="btn sm" disabled={pending}
                        onClick={() => run(() => setExempt(r.id, false, null, ''))}>
                        Remove exemption
                      </button>
                    ) : (
                      EXEMPT_REASONS.map((opt) => (
                        <button key={opt.value} className="btn sm" disabled={pending}
                          onClick={() => run(() => setExempt(r.id, true, opt.value, ''))}>
                          {opt.label}
                        </button>
                      ))
                    )}
                  </div>
                  {r.exempt && r.exemptNotes && (
                    <div className="detail-hint">{r.exemptNotes}</div>
                  )}
                </div>

                <div className="detail-group">
                  <span className="detail-label">PIN</span>
                  {!r.hasPin ? (
                    <div className="detail-hint">
                      {r.name} has not set a PIN yet. They choose one the first
                      time they sign in.
                    </div>
                  ) : confirmReset === r.id ? (
                    <>
                      <div className="detail-warn">
                        This wipes their PIN so they can choose a new one, exactly
                        like their first sign-in. Until they do, anyone who picks
                        their name could set it — so tell {r.name.split(' ')[0]} to
                        sign in now.
                      </div>
                      <div className="detail-actions">
                        <button
                          className="btn sm danger-on"
                          disabled={pending}
                          onClick={() => {
                            setConfirmReset(null);
                            run(() =>
                              resetMemberPin(r.id).then((x) => ({
                                ok: x.ok,
                                message: x.ok
                                  ? `${r.name}'s PIN is cleared — they set a new one next sign-in.`
                                  : (x.error ?? 'Failed'),
                              })),
                            );
                          }}
                        >
                          Yes, reset it
                        </button>
                        <button
                          className="btn sm"
                          onClick={() => setConfirmReset(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="detail-actions">
                        <button
                          className="btn sm"
                          disabled={pending}
                          onClick={() => setConfirmReset(r.id)}
                        >
                          Reset PIN
                        </button>
                      </div>
                      <div className="detail-hint">
                        Use this when somebody forgets theirs, or to undo a PIN
                        that was set by mistake.
                      </div>
                    </>
                  )}
                </div>

                <div className="detail-group">
                  <span className="detail-label">Roster</span>
                  <div className="detail-actions">
                    <button className="btn sm" disabled={pending}
                      onClick={() => run(() => setActive(r.id, !r.active))}>
                      {r.active ? 'Remove from roster' : 'Restore to roster'}
                    </button>
                  </div>
                  <div className="detail-hint">
                    Removing keeps their history; it only stops them being
                    scheduled.
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {shown.length === 0 && (
          <div className="card card-pad">
            <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
              Nobody matches that.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
