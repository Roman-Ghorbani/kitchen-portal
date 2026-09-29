'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import {
  adminDeleteWeek,
  adminRemove,
  adminAdd,
  adminCancelSlot,
  adminEnableSlot,
} from '../../../actions/week-admin-actions.ts';
import {
  markAttendance,
  placeSubstitute,
  changeShiftPoints,
  openShiftForCover,
  offerForOpenSeat,
} from '../../../actions/shift-actions.ts';
import { POINT_MULTIPLIERS, formatPoints } from '../../../../lib/types.ts';
import { dayIndex } from '../../../../lib/dates.ts';

export interface Person {
  id: string;
  name: string;
  rotation: string;
  points: number;
  exempt: boolean;
  makeupDebt?: number;
  lastServedDate?: string | null;
  standingConflicts?: number[];
}

export interface SlotView {
  slotId: string;
  date: string;
  meal: 'lunch' | 'dinner';
  size: number;
  coverBounty: number;
  assignments: {
    id: string;
    memberId: string;
    memberName: string;
    rotation: string;
    status: string;
    coveredByName: string | null;
    multiplier: number;
    isMakeup: boolean;
  }[];
}

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const router = useRouter();

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.message);
      setBad(!res.ok);
      router.refresh();
    });
  }

  return { pending, msg, bad, run };
}

/* ------------------------------------------------------------------ */
/* Week-level controls                                                 */
/* ------------------------------------------------------------------ */

export function WeekControls({
  weekId,
  weekStart,
  weekLabel,
  status,
  hasStarted,
  unresolved,
  isArchived = false,
}: {
  weekId: string;
  weekStart: string;
  weekLabel: string;
  status: string;
  hasStarted: boolean;
  unresolved: number;
  isArchived?: boolean;
}) {
  const { pending, msg, bad, run } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const finished = status === 'complete';

  return (
    <div className="card card-pad wk-panel">
      <div className="wk-head">
        <div>
          <div className="wk-title">{weekLabel}</div>
          <div className="wk-sub">
            {isArchived
              ? 'Archived record — all shifts have concluded. Shift history and attendance are preserved.'
              : finished
                ? 'Finished — every shift on it has been and gone.'
                : 'Posted. Brothers can put a shift up for grabs at any time, and anyone can take one.'}
            {hasStarted && !finished && !isArchived && ' This week has already started.'}
          </div>
        </div>
        <span className={`wk-state ${isArchived || finished ? 'locked' : 'open'}`}>
          {isArchived ? 'Archived' : finished ? 'Finished' : 'Posted'}
        </span>
      </div>

      {unresolved > 0 && !finished && (
        <div className="alert bad" style={{ marginTop: 14, marginBottom: 0 }}>
          <span className="alert-title">
            {unresolved} seat{unresolved === 1 ? '' : 's'} nobody has taken
          </span>
          <span className="alert-body">
            {unresolved === 1 ? 'It is' : 'They are'} still the original
            brother&apos;s until somebody claims{' '}
            {unresolved === 1 ? 'it' : 'them'}. Put somebody on{' '}
            {unresolved === 1 ? 'it' : 'them'} yourself, or raise what{' '}
            {unresolved === 1 ? 'it is' : 'they are'} worth.
          </span>
        </div>
      )}

      <div className="row-actions">
        {!hasStarted &&
          (!confirmDelete ? (
            <button
              className="btn danger"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Delete this week
            </button>
          ) : (
            <>
              <button
                className="btn danger-on"
                disabled={pending}
                onClick={() => run(() => adminDeleteWeek(weekId))}
              >
                Delete it — everyone gets their points back
              </button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ))}
      </div>

      {hasStarted && (
        <div className="note">
          A week that has started cannot be deleted — brothers have worked
          shifts from it, and that record is the point. Edit individual shifts
          below instead.
        </div>
      )}

      {msg && (
        <div className="note" style={bad ? { color: 'var(--red-600)' } : undefined}>
          {msg}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shift-level controls                                                */
/* ------------------------------------------------------------------ */

function engineCompare(
  a: Person,
  b: Person,
  wantCrew?: 'lunch' | 'dinner' | null,
  slotDayIdx?: number,
): number {
  if (wantCrew) {
    const aMatch = a.rotation === wantCrew ? 0 : 1;
    const bMatch = b.rotation === wantCrew ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
  }

  if (a.exempt !== b.exempt) return a.exempt ? 1 : -1;

  if (slotDayIdx !== undefined && slotDayIdx >= 0) {
    const aConf = (a.standingConflicts ?? []).includes(slotDayIdx) ? 1 : 0;
    const bConf = (b.standingConflicts ?? []).includes(slotDayIdx) ? 1 : 0;
    if (aConf !== bConf) return aConf - bConf;
  }

  const aDebt = a.makeupDebt ?? 0;
  const bDebt = b.makeupDebt ?? 0;
  if (aDebt !== bDebt) return bDebt - aDebt;

  if (a.points !== b.points) return a.points - b.points;

  const al = a.lastServedDate ?? null;
  const bl = b.lastServedDate ?? null;
  if (al === null && bl !== null) return -1;
  if (bl === null && al !== null) return 1;
  if (al !== null && bl !== null && al !== bl) return al < bl ? -1 : 1;

  return a.name.localeCompare(b.name);
}

export function PersonPicker({
  roster,
  slotDate,
  slotMeal,
  onPick,
  disabled,
  placeholder,
}: {
  roster: Person[];
  slotDate?: string;
  slotMeal?: 'lunch' | 'dinner';
  onPick: (id: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [q, setQ] = useState('');

  const slotDayIdx = slotDate ? dayIndex(slotDate) : -1;
  const wantCrew = slotMeal ?? null;

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => engineCompare(a, b, wantCrew, slotDayIdx));
  }, [roster, wantCrew, slotDayIdx]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return sortedRoster.slice(0, 8);
    return sortedRoster.filter((m) => m.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, sortedRoster]);

  return (
    <div className="picker">
      <input
        className="field"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
      />
      {matches.length > 0 && (
        <div className="picker-results">
          {!q && (
            <div
              className="picker-section-title"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--gold-500)',
                padding: '6px 10px 2px',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              ⭐ Engine Suggestions (Next Up to Serve)
            </div>
          )}
          {matches.map((m, idx) => {
            const hasConflict =
              slotDayIdx >= 0 && (m.standingConflicts ?? []).includes(slotDayIdx);
            const hasDebt = (m.makeupDebt ?? 0) > 0;
            const isTopPick = !q && idx === 0 && !m.exempt && !hasConflict;

            return (
              <button
                key={m.id}
                className="picker-row"
                disabled={disabled}
                onClick={() => {
                  onPick(m.id);
                  setQ('');
                }}
              >
                <span className="picker-name">{m.name}</span>
                {isTopPick && (
                  <span className="tag ok" style={{ fontSize: 10 }}>
                    ⭐ #1 Engine Pick
                  </span>
                )}
                {hasDebt && (
                  <span className="tag bad" style={{ fontSize: 10 }}>
                    🔥 {m.makeupDebt} Make-up Owed
                  </span>
                )}
                {hasConflict && (
                  <span className="tag bad" style={{ fontSize: 10 }}>
                    ⚠️ Standing Conflict
                  </span>
                )}
                <span className={`tag ${m.rotation === 'lunch' ? 'jun' : 'soph'}`}>
                  {m.rotation === 'lunch' ? 'lunch rotation' : 'dinner rotation'}
                </span>
                <span className="roster-pts mono">{formatPoints(m.points)} pts</span>
                {m.exempt && <span className="tag locked">exempt</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One shift, with everything the manager might need to do to it.
 *
 * Attendance and roster edits live together deliberately: standing in the
 * kitchen finding somebody missing, the decision is a single one - mark them
 * absent, or put somebody else on right now - and splitting those across two
 * screens made a fast job into a slow one.
 */
export function SlotEditor({
  slot,
  roster,
  isPast,
}: {
  slot: SlotView;
  roster: Person[];
  isPast: boolean;
}) {
  const { pending, msg, bad, run } = useAction();
  const [panel, setPanel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [otherCrew, setOtherCrew] = useState(false);
  const [bounty, setBounty] = useState<number>(1);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [offer, setOffer] = useState<number>(2);
  const [reason, setReason] = useState('');

  const openSeats = slot.size - slot.assignments.length;
  const eligible = roster;

  return (
    <div className="slot-editor">
      <div className="slot-editor-head">
        <span className="slot-editor-meal">
          {slot.meal === 'lunch' ? 'Lunch' : 'Dinner'}
        </span>
        <span className="slot-editor-count mono">
          {slot.assignments.length}/{slot.size}
        </span>
        {openSeats > 0 && <span className="tag bad">{openSeats} open</span>}
        <button
          className="btn sm danger"
          style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px' }}
          disabled={pending}
          onClick={() => {
            if (confirm(`Cancel kitchen service for ${slot.meal === 'lunch' ? 'Lunch' : 'Dinner'}? Any assigned points will be returned.`)) {
              run(() => adminCancelSlot(slot.slotId));
            }
          }}
        >
          🚫 Cancel Service
        </button>
      </div>

      {slot.assignments.map((a) => (
        <div key={a.id} className="slot-person">
          <div className="slot-person-main">
            <span className="slot-person-name">{a.memberName}</span>
            {a.coveredByName && (
              <span className="tag ok">covered by {a.coveredByName}</span>
            )}
            {a.status === 'flagged' && <span className="tag bad">needs cover</span>}
            {a.status === 'no-show' && <span className="tag bad">no-show</span>}
            {a.status === 'excused' && <span className="tag locked">excused</span>}
            {a.isMakeup && <span className="tag violet">make-up</span>}
            {a.multiplier > 1 && (
              <span className="wg-mult mono">{a.multiplier}×</span>
            )}
          </div>

          {/* Attendance: only meaningful once the day has arrived. */}
          {isPast && (
            <div className="slot-attendance">
              <span className="slot-attendance-label">Showed up?</span>
              <button
                className={`btn sm${a.status === 'no-show' ? ' danger-on' : ''}`}
                disabled={pending}
                onClick={() => run(() => markAttendance(a.id, 'no-show'))}
              >
                No-show
              </button>
              <button
                className={`btn sm${a.status === 'excused' ? ' excused-on' : ''}`}
                disabled={pending}
                onClick={() => run(() => markAttendance(a.id, 'excused'))}
              >
                Excuse
              </button>
              {a.status !== 'assigned' && a.status !== 'covered' && (
                <button
                  className="btn sm"
                  disabled={pending}
                  onClick={() => run(() => markAttendance(a.id, 'assigned'))}
                >
                  Undo
                </button>
              )}
            </div>
          )}

          {/* What the shift is worth, always available. Who serves it and
              what it pays are two separate decisions; bundling them meant the
              only way to award extra was to re-pick the same person. */}
          <div className="slot-points">
            <span className="slot-points-label">Worth</span>
            {POINT_MULTIPLIERS.map((m) => (
              <button
                key={m}
                className={`btn sm${a.multiplier === m ? ' gold' : ''}`}
                disabled={pending}
                onClick={() => run(() => changeShiftPoints(a.id, m))}
              >
                {formatPoints(m)}×
              </button>
            ))}
            <span className="slot-points-hint">
              {a.status === 'no-show'
                ? 'no-show — nothing awarded'
                : `${formatPoints(a.multiplier)} point${a.multiplier === 1 ? '' : 's'} to ${
                    a.coveredByName ?? a.memberName
                  }`}
            </span>
          </div>

          <div className="slot-person-actions">
            <button
              className="btn sm"
              disabled={pending}
              onClick={() => setPanel(panel === a.id ? null : a.id)}
            >
              {a.coveredByName ? 'Change who is serving' : 'Someone else is serving'}
            </button>
            <button
              className={`btn sm${a.status === 'flagged' ? ' gold' : ''}`}
              disabled={pending}
              onClick={() => setOpenPanel(openPanel === a.id ? null : a.id)}
            >
              {a.status === 'flagged' ? 'Change the offer' : 'Ask for cover'}
            </button>
            <button
              className="btn sm"
              disabled={pending}
              style={{ color: 'var(--red-500)', borderColor: 'var(--red-500-20)' }}
              onClick={() => run(() => adminRemove(a.id, false))}
              title="Takes member off shift without debt penalty, leaving seat open for any brother to pick up."
            >
              🛡️ Excuse &amp; Remove (No Debt)
            </button>
          </div>

          {openPanel === a.id && (
            <div className="slot-edit-panel">
              <div className="panel-explain">
                Puts {a.memberName}&apos;s shift in front of the whole house as
                needing cover. He earns nothing for it and owes nothing — he
                told you, so he keeps his place and comes back up sooner.
                Offering more points makes it likelier somebody takes it.
              </div>
              <div className="bounty-row">
                <span className="bounty-label">Offer</span>
                {POINT_MULTIPLIERS.map((m) => (
                  <button
                    key={m}
                    className={`btn sm${offer === m ? ' gold' : ''}`}
                    onClick={() => setOffer(m)}
                  >
                    {formatPoints(m)}×
                  </button>
                ))}
              </div>
              <input
                className="field"
                placeholder="Reason (optional) — e.g. told me he has a game"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="detail-actions">
                <button
                  className="btn primary sm"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await openShiftForCover(a.id, offer, reason);
                      if (r.ok) {
                        setOpenPanel(null);
                        setReason('');
                      }
                      return r;
                    })
                  }
                >
                  Post it to the house at {formatPoints(offer)}×
                </button>
                <button className="btn sm" onClick={() => setOpenPanel(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {panel === a.id && (
            <div className="slot-edit-panel">
              <div className="panel-explain">
                Whoever you pick takes this shift and earns the points.{' '}
                {a.memberName} earns nothing for it and keeps their place in the
                rotation, so they come back up sooner.
              </div>
              <div className="bounty-row">
                <span className="bounty-label">Worth</span>
                {POINT_MULTIPLIERS.map((m) => (
                  <button
                    key={m}
                    className={`btn sm${bounty === m ? ' gold' : ''}`}
                    onClick={() => setBounty(m)}
                  >
                    {formatPoints(m)}×
                  </button>
                ))}
              </div>
              <PersonPicker
                roster={roster}
                slotDate={slot.date}
                slotMeal={slot.meal}
                disabled={pending}
                placeholder="Who is actually serving this?"
                onPick={(id) =>
                  run(async () => {
                    const r = await placeSubstitute(a.id, id, bounty);
                    if (r.ok) {
                      setPanel(null);
                      setBounty(1);
                    }
                    return r;
                  })
                }
              />
            </div>
          )}
        </div>
      ))}

      {slot.assignments.length === 0 && (
        <div className="slot-empty">Nobody assigned</div>
      )}

      {openSeats > 0 && (
        <div className="slot-open-offer">
          <span className="slot-points-label">
            {openSeats} open seat{openSeats === 1 ? '' : 's'} —
          </span>
          <button
            className={`btn sm${slot.coverBounty <= 0 ? ' primary' : ''}`}
            disabled={pending}
            onClick={() => run(() => offerForOpenSeat(slot.slotId, 0))}
            style={{ fontWeight: 600 }}
          >
            🔒 Close Bounty (0×)
          </button>
          {POINT_MULTIPLIERS.map((m) => (
            <button
              key={m}
              className={`btn sm${slot.coverBounty === m ? ' gold' : ''}`}
              disabled={pending}
              onClick={() => run(() => offerForOpenSeat(slot.slotId, m))}
            >
              📢 Open {formatPoints(m)}×
            </button>
          ))}
          <span className="slot-points-hint">
            {slot.coverBounty <= 0
              ? 'Bounty is closed. Open seats are locked and hidden from house claim.'
              : `Anyone in the house can claim open seats at ${formatPoints(slot.coverBounty)}x.`}
          </span>
        </div>
      )}

      {openSeats > 0 && (
        <div className="slot-add">
          {!adding ? (
            <button className="btn sm" onClick={() => setAdding(true)}>
              + Add someone
            </button>
          ) : (
            <div className="slot-edit-panel">
              <PersonPicker
                roster={eligible}
                slotDate={slot.date}
                slotMeal={slot.meal}
                disabled={pending}
                placeholder="Who should be on this shift?"
                onPick={(id) =>
                  run(async () => {
                    const r = await adminAdd(slot.slotId, id, otherCrew);
                    if (r.ok) setAdding(false);
                    return r;
                  })
                }
              />
              <label className="check-inline">
                <input type="checkbox" checked={otherCrew} onChange={(e) => setOtherCrew(e.target.checked)} />
                Allow the other rotation
              </label>
              <button className="btn sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div
          className="slot-msg"
          style={bad ? { color: 'var(--red-600)' } : undefined}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
