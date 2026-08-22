import { redirect } from 'next/navigation';

import { getSession } from '../../../lib/session.ts';
import { getMyShifts, getMemberById } from '../../../lib/member-queries.ts';
import { parseISO } from '../../../lib/dates.ts';
import { AppShell } from '../shell.tsx';
import { FlagButton } from './flag-button.tsx';

function pastDeadline(locksAt: Date | null): boolean {
  return locksAt !== null && new Date() > locksAt;
}

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function MyShiftsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role === 'admin') redirect('/admin');

  const [member, shifts] = await Promise.all([
    getMemberById(session.sub),
    getMyShifts(session.sub),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = shifts.filter((s) => s.date >= today);
  const past = shifts.filter((s) => s.date < today);

  return (
    <AppShell
      session={session}
      active="/my-shifts"
      title="My Shifts"
      subtitle={
        member?.classYear === 'junior'
          ? 'You are on lunch duty'
          : 'You are on dinner duty'
      }
    >
      <div className="hero">
        <div>
          <h2>{session.name}</h2>
          <div className="hero-sub">
            {member?.exempt
              ? `Exempt — ${member.exemptReason ?? 'no reason given'}`
              : member?.classYear === 'junior'
                ? 'Lunch duty · juniors'
                : 'Dinner duty · sophomores'}
          </div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="hv mono">{member?.points ?? 0}</div>
            <div className="hl">Points</div>
          </div>
          <div className="hero-stat">
            <div className="hv mono">{upcoming.length}</div>
            <div className="hl">Upcoming</div>
          </div>
          {(member?.makeupDebt ?? 0) > 0 && (
            <div className="hero-stat">
              <div className="hv mono owed">{member!.makeupDebt}</div>
              <div className="hl">Owed</div>
            </div>
          )}
        </div>
      </div>

      <h2 className="section-title">Your upcoming duty</h2>

      {upcoming.length === 0 ? (
        <div className="card card-pad">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            Nothing scheduled right now.
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            {member?.exempt
              ? 'You are marked exempt, so you are not in the rotation. You can still pick up a shift any time.'
              : 'You will show up here as soon as a week including you is posted.'}
          </div>
        </div>
      ) : (
        upcoming.map((s) => (
          <div key={s.assignmentId} className="shift-row">
            <div className="shift-when">
              <div className="shift-day">{fmt(s.date)}</div>
              <div className="shift-crew">
                {s.crew.length > 0 ? `With ${s.crew.join(', ')}` : 'On your own'}
              </div>
            </div>

            <span className={`tag ${s.meal === 'lunch' ? 'jun' : 'soph'}`}>
              {s.meal === 'lunch' ? 'Lunch' : 'Dinner'}
            </span>

            {s.isMakeup && <span className="tag bad">Make-up</span>}

            {s.status === 'flagged' && (
              <span className="tag bad">Flagged — open to the house</span>
            )}

            {s.coveredByName && (
              <span className="tag ok">Covered by {s.coveredByName}</span>
            )}

            {s.status === 'assigned' && (
              <FlagButton
                assignmentId={s.assignmentId}
                disabled={s.weekStatus !== 'posted' || pastDeadline(s.weekLocksAt)}
                disabledReason={
                  s.weekStatus !== 'posted'
                    ? 'Locked — contact Roman'
                    : 'Deadline passed'
                }
              />
            )}
          </div>
        ))
      )}

      {past.length > 0 && (
        <>
          <h2 className="section-title">Already served</h2>
          {past.slice(-5).reverse().map((s) => (
            <div key={s.assignmentId} className="shift-row past">
              <div className="shift-when">
                <div className="shift-day">{fmt(s.date)}</div>
              </div>
              <span className="tag locked">{s.meal}</span>
              <span className={`tag ${s.status === 'no-show' ? 'bad' : 'ok'}`}>
                {s.status}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="note">
        Have a class that repeats every week? Set it once under Availability
        instead of flagging it every time — you simply will not be scheduled
        then.
      </div>
    </AppShell>
  );
}
