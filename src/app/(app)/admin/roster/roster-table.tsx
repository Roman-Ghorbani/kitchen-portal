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
import { formatPoints } from '../../../../lib/types.ts';

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

type Filter =
  | 'all'
  | 'junior'
  | 'sophomore'
  | 'no-pin'
  | 'owing'
  | 'exempt'
  | 'has-conflicts'
  | 'inactive';

type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'points-desc'
  | 'points-asc'
  | 'debt-desc'
  | 'conflicts-desc';

const EXEMPT_REASONS = [
  { value: 'officer', label: 'House officer role' },
  { value: 'medical', label: 'Medical / health' },
  { value: 'off-campus', label: 'Off-campus' },
  { value: 'other', label: 'Other' },
] as const;

export function RosterTable({ rows }: { rows: RosterRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortOption>('name-asc');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const counts = useMemo(
    () => ({
      all: rows.length,
      junior: rows.filter((r) => r.active && r.classYear === 'junior').length,
      sophomore: rows.filter((r) => r.active && r.classYear === 'sophomore').length,
      'no-pin': rows.filter((r) => r.active && !r.hasPin).length,
      owing: rows.filter((r) => r.active && r.makeupDebt > 0).length,
      exempt: rows.filter((r) => r.active && r.exempt).length,
      'has-conflicts': rows.filter((r) => r.active && r.standingConflicts > 0).length,
      inactive: rows.filter((r) => !r.active).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'junior':
          return r.active && r.classYear === 'junior';
        case 'sophomore':
          return r.active && r.classYear === 'sophomore';
        case 'exempt':
          return r.active && r.exempt;
        case 'no-pin':
          return r.active && !r.hasPin;
        case 'owing':
          return r.active && r.makeupDebt > 0;
        case 'has-conflicts':
          return r.active && r.standingConflicts > 0;
        case 'inactive':
          return !r.active;
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'points-desc':
          return b.points - a.points || a.name.localeCompare(b.name);
        case 'points-asc':
          return a.points - b.points || a.name.localeCompare(b.name);
        case 'debt-desc':
          return b.makeupDebt - a.makeupDebt || a.name.localeCompare(b.name);
        case 'conflicts-desc':
          return b.standingConflicts - a.standingConflicts || a.name.localeCompare(b.name);
        case 'name-asc':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [rows, query, filter, sort]);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMessage(res.message);
      setFailed(!res.ok);
      router.refresh();
    });
  }

  return (
    <>
      <div
        className="card card-pad"
        style={{ marginBottom: 20, border: '1px solid var(--line)' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              className="field"
              placeholder="🔍 Search roster by member name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-400)' }}>
              Sort by:
            </label>
            <select
              className="field"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              style={{ padding: '6px 10px', fontSize: 13, background: 'var(--card)' }}
            >
              <option value="name-asc">Name (A → Z)</option>
              <option value="name-desc">Name (Z → A)</option>
              <option value="points-desc">Points (High → Low)</option>
              <option value="points-asc">Points (Low → High)</option>
              <option value="debt-desc">Make-up Debt (High → Low)</option>
              <option value="conflicts-desc">Conflicts (Most → Least)</option>
            </select>
          </div>
        </div>

        <div className="filter-chips">
          {(
            [
              'all',
              'junior',
              'sophomore',
              'no-pin',
              'owing',
              'exempt',
              'has-conflicts',
              'inactive',
            ] as Filter[]
          ).map((f) => (
            <button
              key={f}
              className={`filter-chip${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? 'All'
                : f === 'junior'
                  ? 'Juniors (Lunch)'
                  : f === 'sophomore'
                    ? 'Sophomores (Dinner)'
                    : f === 'no-pin'
                      ? 'No PIN'
                      : f === 'owing'
                        ? 'Owes Make-up'
                        : f === 'exempt'
                          ? 'Exempt'
                          : f === 'has-conflicts'
                            ? 'Has Conflicts'
                            : 'Off Roster'}
              <span className="chip-count mono">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div
          className="note"
          style={
            failed
              ? { color: 'var(--red-600)', borderColor: 'var(--red-500-20)' }
              : { color: 'var(--green-600)', borderColor: 'var(--green-500-20)' }
          }
        >
          {message}
        </div>
      )}

      <div className="roster-list">
        {shown.map((r) => (
          <div
            key={r.id}
            className={`roster-row${r.exempt ? ' is-exempt' : ''}${!r.active ? ' inactive' : ''}`}
          >
            <button
              className="roster-main"
              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            >
              <span className="roster-name">{r.name}</span>

              <span className={`tag ${r.classYear === 'junior' ? 'jun' : 'soph'}`}>
                {r.classYear === 'junior' ? 'Junior · Lunch' : 'Sophomore · Dinner'}
              </span>

              <span className="roster-pts mono" title="Kitchen points">
                {formatPoints(r.points)} pts
              </span>

              {r.makeupDebt > 0 && (
                <span className="tag bad" style={{ fontWeight: 700 }}>
                  owes {r.makeupDebt} shift{r.makeupDebt === 1 ? '' : 's'}
                </span>
              )}
              {r.exempt && (
                <span className="tag locked">
                  Exempt ({r.exemptReason ?? 'custom'})
                </span>
              )}
              {!r.hasPin && <span className="tag bad">No PIN</span>}
              {r.standingConflicts > 0 && (
                <span className="tag ok">
                  {r.standingConflicts} conflict{r.standingConflicts === 1 ? '' : 's'}
                </span>
              )}
              {!r.active && <span className="tag bad">Off Roster</span>}
            </button>

            {expanded === r.id && (
              <div className="roster-detail">
                <div className="detail-group">
                  <span className="detail-label">Member Dossier &amp; History</span>
                  <div className="detail-actions">
                    <Link className="btn sm primary" href={`/admin/member/${r.id}`}>
                      👤 See Full Record &amp; Dossier for {r.name} →
                    </Link>
                  </div>
                  <div className="detail-hint">
                    Inspect complete shift history, flagged conflicts, exact timestamps,
                    and point corrections.
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Duty Class &amp; Meal</span>
                  <div className="detail-actions">
                    {(['junior', 'sophomore'] as const).map((y) => (
                      <button
                        key={y}
                        className={`btn sm${r.classYear === y ? ' primary' : ''}`}
                        disabled={pending}
                        onClick={() => run(() => setClassYear(r.id, y))}
                      >
                        {y === 'junior' ? 'Junior (Lunch duty)' : 'Sophomore (Dinner duty)'}
                      </button>
                    ))}
                  </div>
                  <div className="detail-hint">
                    Swaps duty assignment between Lunch (Juniors) and Dinner (Sophomores).
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Kitchen Points</span>
                  <div className="detail-actions">
                    <button
                      className="btn sm"
                      disabled={pending}
                      onClick={() => run(() => adjustPoints(r.id, -1))}
                    >
                      −1 Point
                    </button>
                    <span className="roster-pts mono" style={{ fontSize: 16, fontWeight: 700 }}>
                      {formatPoints(r.points)} pts
                    </span>
                    <button
                      className="btn sm"
                      disabled={pending}
                      onClick={() => run(() => adjustPoints(r.id, 1))}
                    >
                      +1 Point
                    </button>
                  </div>
                </div>

                <div className="detail-group">
                  <span className="detail-label">Exemption Status</span>
                  <div className="detail-actions">
                    {r.exempt ? (
                      <button
                        className="btn sm primary"
                        disabled={pending}
                        onClick={() => run(() => setExempt(r.id, false, null, ''))}
                      >
                        ✓ Remove Exemption (Place back on duty)
                      </button>
                    ) : (
                      EXEMPT_REASONS.map((opt) => (
                        <button
                          key={opt.value}
                          className="btn sm"
                          disabled={pending}
                          onClick={() => run(() => setExempt(r.id, true, opt.value, ''))}
                        >
                          Mark Exempt: {opt.label}
                        </button>
                      ))
                    )}
                  </div>
                  {r.exempt && r.exemptNotes && (
                    <div className="detail-hint">{r.exemptNotes}</div>
                  )}
                </div>

                <div className="detail-group">
                  <span className="detail-label">App PIN &amp; Security</span>
                  {!r.hasPin ? (
                    <div className="detail-hint">
                      {r.name} has not set a PIN yet. They will choose a 4-digit PIN the first time they sign in.
                    </div>
                  ) : confirmReset === r.id ? (
                    <>
                      <div className="detail-warn">
                        Wipes {r.name}&apos;s 4-digit PIN so they can choose a new one on their next sign-in.
                      </div>
                      <div className="detail-actions">
                        <button
                          className="btn sm danger"
                          disabled={pending}
                          onClick={() => {
                            setConfirmReset(null);
                            run(() =>
                              resetMemberPin(r.id).then((x) => ({
                                ok: x.ok,
                                message: x.ok
                                  ? `${r.name}'s PIN has been cleared.`
                                  : (x.error ?? 'Failed to reset PIN'),
                              })),
                            );
                          }}
                        >
                          Yes, Reset PIN
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
                          🔑 Reset Forgotten PIN
                        </button>
                      </div>
                      <div className="detail-hint">
                        Clears their PIN if forgotten, allowing them to choose a new one upon signing in.
                      </div>
                    </>
                  )}
                </div>

                <div className="detail-group">
                  <span className="detail-label">Roster Active Status</span>
                  <div className="detail-actions">
                    <button
                      className={`btn sm${!r.active ? ' primary' : ''}`}
                      disabled={pending}
                      onClick={() => run(() => setActive(r.id, !r.active))}
                    >
                      {r.active ? 'Remove from Active Roster' : 'Restore to Active Roster'}
                    </button>
                  </div>
                  <div className="detail-hint">
                    Removing a member preserves their past history while excluding them from future schedule generation.
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {shown.length === 0 && (
          <div className="card card-pad">
            <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
              No members match the selected search or filter criteria.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
