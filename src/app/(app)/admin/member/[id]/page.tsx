import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';

import { getSession } from '../../../../../lib/session.ts';
import { getMemberDossier } from '../../../../../lib/member-dossier.ts';
import { parseISO, formatEasternTimestamp } from '../../../../../lib/dates.ts';
import { formatPoints } from '../../../../../lib/types.ts';
import { AppShell } from '../../../shell.tsx';
import { AdminAvailabilityEditor } from './admin-availability.tsx';

export const dynamic = 'force-dynamic';

const DAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

function shiftDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function stamp(d: Date | null): string {
  return formatEasternTimestamp(d);
}

export default async function MemberDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/my-shifts');

  const { id } = await params;
  const dossier = await getMemberDossier(id);
  if (!dossier) notFound();

  const { member, shifts, timeline, conflicts, totals } = dossier;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell
      session={session}
      active="/admin/roster"
      title={member.name}
      subtitle={`${member.classYear} · ${member.classYear === 'junior' ? 'lunch' : 'dinner'} duty`}
    >
      <Link className="btn sm" href="/admin/roster">
        ← Back to roster
      </Link>

      <div className="dossier-stats">
        {[
          ['Points', formatPoints(totals.points)],
          ['Scheduled', totals.scheduled],
          ['Served', totals.served],
          ['Picked up', totals.pickedUp],
          ['Flagged', totals.flagged],
          ['No-shows', totals.noShows],
        ].map(([label, value]) => (
          <div
            key={label}
            className={`dossier-stat${label === 'No-shows' && Number(value) > 0 ? ' bad' : ''}`}
          >
            <span className="dossier-stat-value mono">{value}</span>
            <span className="dossier-stat-label">{label}</span>
          </div>
        ))}
      </div>

      {(member.exempt || member.makeupDebt > 0 || !member.active) && (
        <div className="alert warn">
          <span className="alert-title">Flags on this member</span>
          <span className="alert-body">
            {member.exempt && `Exempt — ${member.exemptReason ?? 'no reason given'}. `}
            {member.makeupDebt > 0 &&
              `Owes ${member.makeupDebt} make-up shift${member.makeupDebt === 1 ? '' : 's'}. `}
            {!member.active && 'Removed from the roster. '}
          </span>
        </div>
      )}

      <h2 className="section-title">
        Standing availability &amp; conflicts
        <span className="section-count mono">{conflicts.length}</span>
      </h2>

      <AdminAvailabilityEditor
        memberId={member.id}
        memberName={member.name}
        initialConflicts={conflicts.map((c) => ({
          dayIndex: c.dayIndex,
          note: c.note,
        }))}
      />

      {/* The answer to "nobody told me". Notice given is stated per shift. */}
      <h2 className="section-title">
        Every shift
        <span className="section-count mono">{shifts.length}</span>
      </h2>

      {shifts.length === 0 ? (
        <div className="card card-pad">
          <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
            Never scheduled yet.
          </span>
        </div>
      ) : (
        <div className="dossier-shifts">
          {shifts.map((s) => {
            const noShow = s.status === 'no-show';
            const past = s.date < today;

            return (
              <div
                key={s.assignmentId}
                className={`dossier-shift${noShow ? ' bad' : ''}`}
              >
                <div className="ds-when">
                  <span className="ds-date">{shiftDate(s.date)}</span>
                  <span className="ds-meal">
                    {s.meal === 'lunch' ? 'Lunch' : 'Dinner'}
                    {s.covering && ` · covering ${s.coveringForName}`}
                    {s.coveredByName && ` · ${s.coveredByName} took it`}
                    {s.isMakeup && ' · make-up'}
                  </span>
                </div>

                <div className="ds-notice">
                  <span className="ds-notice-line">
                    Posted {stamp(s.postedAt)}
                  </span>
                  <span className="ds-notice-line">
                    {s.noticeDays !== null
                      ? `${s.noticeDays} day${s.noticeDays === 1 ? '' : 's'} notice`
                      : 'notice unknown'}
                    {s.locksAt && ` · flagging closed ${stamp(s.locksAt)}`}
                  </span>
                </div>

                <div className="ds-outcome">
                  <span
                    className={`tag ${
                      noShow
                        ? 'bad'
                        : s.status === 'flagged'
                          ? 'bad'
                          : s.pointsAwarded > 0
                            ? 'ok'
                            : 'locked'
                    }`}
                  >
                    {noShow
                      ? 'No-show'
                      : s.status === 'flagged'
                        ? 'Flagged, open'
                        : s.status === 'excused'
                          ? 'Excused'
                          : s.coveredByName
                            ? 'Handed off'
                            : past
                              ? 'Served'
                              : 'Upcoming'}
                  </span>
                  <span className="ds-points mono">
                    {s.pointsAwarded > 0 ? `+${formatPoints(s.pointsAwarded)}` : '0'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="section-title">
        Everything on record
        <span className="section-count mono">{timeline.length}</span>
      </h2>

      <div className="card">
        {timeline.length === 0 ? (
          <div className="card-pad">
            <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
              Nothing logged for this member yet.
            </span>
          </div>
        ) : (
          <div className="dossier-timeline">
            {timeline.map((e) => (
              <div key={e.id} className="dt-row">
                <span className="dt-when mono">{stamp(e.createdAt)}</span>
                <span className="dt-what">{e.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="note">
        This is the record. Every line is written when it happens and is never
        edited afterwards — including your own corrections, which appear here
        under your name.
      </div>
    </AppShell>
  );
}
