import { redirect } from 'next/navigation';

import { getSession, getViewAs } from '../../../lib/session.ts';
import { getMemberById } from '../../../lib/member-queries.ts';
import { getStandings } from '../../../lib/standings.ts';
import { formatPoints } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { StandingsList } from './standings-list.tsx';

export const dynamic = 'force-dynamic';

export default async function StandingsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');

  const viewAs = await getViewAs();
  const meId = viewAs ?? (session.role === 'brother' ? session.sub : null);
  const previewed = viewAs ? await getMemberById(viewAs) : null;
  const { rows, me } = await getStandings(meId);

  // Where the viewer sits across the whole spread, for the bar. Falls back to
  // the midpoint when the roster is flat, which it is at the start of term.
  const top = rows[0]?.points ?? 0;
  const bottom = rows[rows.length - 1]?.points ?? 0;
  const pct =
    me && top !== bottom
      ? Math.round(((top - me.points) / (top - bottom)) * 100)
      : 50;

  return (
    <AppShell
      session={session}
      active="/standings"
      viewingAs={previewed?.name ?? null}
      title="Standings"
      subtitle="Everyone on the rotation, most points to fewest"
    >
      {me && (
        <div className="st-me">
          <div className="st-me-top">
            <div className="st-me-block">
              <span className="st-me-label">You</span>
              <span className="st-me-value mono">
                {formatPoints(me.points)}
                <span className="st-me-unit">points</span>
              </span>
            </div>
            <div className="st-me-block right">
              <span className="st-me-label">Standing</span>
              <span className="st-me-value mono">
                {me.rank}
                <span className="st-me-unit">/{me.total}</span>
              </span>
            </div>
          </div>

          <div className="st-bar" role="img" aria-label={`You are ${me.rank} of ${me.total}`}>
            <div className="st-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="st-bar-ends">
            <span>Most points</span>
            <span>Fewest</span>
          </div>
        </div>
      )}

      {session.role === 'admin' && (
        <div className="alert info">
          <span className="alert-title">Everyone on the rotation</span>
          <span className="alert-body">
            Exempt brothers are left out. This is the same list the house sees.
          </span>
        </div>
      )}

      <StandingsList rows={rows} meId={meId} />

      <div className="st-foot">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          Points are one input into the draw, not all of it &mdash; make-up
          debt, how long since you last served, standing conflicts and the
          tie-break all move it. Where you sit here does not tell you which
          week you are on.
        </span>
      </div>
    </AppShell>
  );
}
