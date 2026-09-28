'use client';

import { useMemo, useState } from 'react';

import { formatPoints } from '../../../lib/types.ts';
import type { StandingRow } from '../../../lib/standings.ts';

type Pool = 'all' | 'lunch' | 'dinner';

const POOLS: { key: Pool; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'lunch', label: 'Lunch crew' },
  { key: 'dinner', label: 'Dinner crew' },
];

/** How many rows to show at each end before collapsing the middle. */
const HEAD = 4;
const TAIL_AROUND_ME = 2;

export function StandingsList({
  rows,
  meId,
}: {
  rows: StandingRow[];
  meId: string | null;
}) {
  const [pool, setPool] = useState<Pool>('all');
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(
    () =>
      pool === 'all' ? rows : rows.filter((r) => r.rotation === pool),
    [pool, rows],
  );

  // Ranks are always the ones from the full list, so filtering to one crew does
  // not renumber everybody and quietly change what the page is claiming.
  const myIndex = meId ? filtered.findIndex((r) => r.id === meId) : -1;

  const visible = useMemo(() => {
    if (expanded || filtered.length <= HEAD + 5) {
      return { head: filtered, hiddenMiddle: 0, near: [], hiddenTail: 0 };
    }
    const head = filtered.slice(0, HEAD);
    if (myIndex < 0) {
      return {
        head,
        hiddenMiddle: filtered.length - HEAD,
        near: [],
        hiddenTail: 0,
      };
    }
    const from = Math.max(HEAD, myIndex - TAIL_AROUND_ME);
    const to = Math.min(filtered.length, myIndex + TAIL_AROUND_ME + 1);
    return {
      head,
      hiddenMiddle: from - HEAD,
      near: filtered.slice(from, to),
      hiddenTail: filtered.length - to,
    };
  }, [expanded, filtered, myIndex]);

  const row = (r: StandingRow) => (
    <div key={r.id} className={`st-row${r.id === meId ? ' is-me' : ''}`}>
      <span className="st-rank mono">{r.rank}</span>
      <span className="st-name">{r.id === meId ? 'You' : r.name}</span>
      <span className="st-year mono" title={r.rotation === 'lunch' ? 'Lunch crew' : 'Dinner crew'}>{r.rotation === 'lunch' ? 'L' : 'D'}</span>
      <span className="st-pts mono">{formatPoints(r.points)}</span>
    </div>
  );

  const spread = (from: StandingRow, to: StandingRow) =>
    `${formatPoints(from.points)} – ${formatPoints(to.points)}`;

  return (
    <>
      <div className="st-pools" role="tablist" aria-label="Which pool">
        {POOLS.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={pool === p.key}
            className={`st-pool${pool === p.key ? ' active' : ''}`}
            onClick={() => setPool(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="st-list">
        {visible.head.map(row)}

        {visible.hiddenMiddle > 0 && (
          <button className="st-more" onClick={() => setExpanded(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
            <span>Show {visible.hiddenMiddle} more</span>
            <span className="st-more-range mono">
              {spread(
                filtered[HEAD],
                filtered[HEAD + visible.hiddenMiddle - 1],
              )}
            </span>
          </button>
        )}

        {visible.near.map(row)}

        {visible.hiddenTail > 0 && (
          <button className="st-more" onClick={() => setExpanded(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
            <span>Show the rest</span>
            <span className="st-more-range mono">{visible.hiddenTail} more</span>
          </button>
        )}
      </div>

      {expanded && filtered.length > HEAD + 5 && (
        <button className="st-collapse" onClick={() => setExpanded(false)}>
          Collapse
        </button>
      )}

      {filtered.length === 0 && (
        <div className="note">Nobody in that year is on the rotation.</div>
      )}
    </>
  );
}
