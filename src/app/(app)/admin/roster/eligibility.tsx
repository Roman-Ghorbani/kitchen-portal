/**
 * Who can actually be drawn on each day.
 *
 * Moved here from the old /admin/stats page, which existed mostly to show this
 * one table and otherwise repeated tiles the dashboard already had. It belongs
 * next to the roster because everything that changes it - an exemption, a
 * standing conflict - is edited on the roster or in a member's record.
 */

import Link from 'next/link';

export interface EligibilityDay {
  index: number;
  short: string;
  full: string;
  lunch: DayPool;
  dinner: DayPool;
}

export interface DayPool {
  total: number;
  available: number;
  blocked: { id: string; name: string; reason: string }[];
}

function Pool({ label, pool }: { label: string; pool: DayPool }) {
  const pct = pool.total > 0 ? Math.round((pool.available / pool.total) * 100) : 100;

  return (
    <div className="elig-pool">
      <div className="elig-pool-head">
        <span className="elig-pool-name">{label}</span>
        <span className="elig-pool-count mono">
          {pool.available}/{pool.total} eligible
        </span>
      </div>

      <div className="elig-bar">
        <div
          className={`elig-bar-fill${pct < 50 ? ' thin' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {pool.blocked.length === 0 ? (
        <span className="elig-none">Everybody is available.</span>
      ) : (
        <div className="elig-blocked">
          {pool.blocked.map((b) => (
            <Link key={b.id} href={`/admin/member/${b.id}`} className="elig-chip">
              <span className="elig-chip-name">{b.name}</span>
              <span className="elig-chip-why">{b.reason}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function EligibilityMatrix({ days }: { days: EligibilityDay[] }) {
  return (
    <div className="elig-grid">
      {days.map((d) => (
        <div key={d.index} className="card card-pad elig-day">
          <h3 className="elig-day-name">{d.full}</h3>
          <div className="elig-day-pools">
            <Pool label="Lunch · juniors" pool={d.lunch} />
            <Pool label="Dinner · sophomores" pool={d.dinner} />
          </div>
        </div>
      ))}
    </div>
  );
}
