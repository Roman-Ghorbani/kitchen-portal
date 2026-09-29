import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';

import { getSession } from '../../../../../lib/session.ts';
import { getMemberDossier } from '../../../../../lib/member-dossier.ts';
import { parseISO, formatEasternTimestamp, todayInEastern } from '../../../../../lib/dates.ts';
import { formatPoints, CLASS_YEAR_LABELS, ROTATION_LABELS } from '../../../../../lib/types.ts';
import { AppShell } from '../../../shell.tsx';
import { AdminAvailabilityEditor } from './admin-availability.tsx';
import { ViewAsButton } from './view-as-button.tsx';
import { MemberControls } from './member-controls.tsx';

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
  if (session.role !== 'admin') redirect('/');

  const { id } = await params;
  const dossier = await getMemberDossier(id);
  if (!dossier) notFound();

  const { member, shifts, timeline, conflicts, totals } = dossier;
  const today = todayInEastern();

  return (
    <AppShell
      session={session}
      active="/admin/roster"
      title={member.name}
      subtitle={[
        CLASS_YEAR_LABELS[member.classYear],
        member.exempt ? 'exempt' : ROTATION_LABELS[member.rotation].toLowerCase(),
        member.room && `room ${member.room}`,
        !member.active && 'off the roster',
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <div className="row-actions" style={{ marginBottom: 4 }}>
        <Link className="btn sm" href="/admin/roster">
          ← Back to roster
        </Link>
        <ViewAsButton memberId={member.id} name={member.name} />
      </div>

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

      <MemberControls
        member={{
          id: member.id,
          name: member.name,
          classYear: member.classYear,
          rotation: member.rotation,
          room: member.room,
          pledgeClass: member.pledgeClass,
          slackUserId: member.slackUserId,
          managerNotes: member.managerNotes,
          exempt: member.exempt,
          exemptReason: member.exemptReason,
          exemptNotes: member.exemptNotes,
          points: member.points,
          makeupDebt: member.makeupDebt,
          hasPin: member.pinHash !== null,
          active: member.active,
          deletable: shifts.length === 0,
        }}
      />

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
            // A shift somebody else took earns him nothing: the point went to them.
            const earned = s.coveredByName ? 0 : s.pointsAwarded;
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
                  </span>
                </div>

                <div className="ds-outcome">
                  <span
                    className={`tag ${
                      noShow
                        ? 'bad'
                        : s.status === 'flagged'
                          ? 'bad'
                          : earned > 0
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
                              : s.date === today
                                ? 'Today'
                                : 'Upcoming'}
                  </span>
                  <span className="ds-points mono">
                    {earned > 0 ? `+${formatPoints(earned)}` : '0'}
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
