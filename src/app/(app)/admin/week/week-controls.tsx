'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import {
  adminUnpublishWeek,
  adminRepublishWeek,
  adminDeleteWeek,
  adminRegenerateWeek,
  adminReassign,
  adminRemove,
  adminAdd,
} from '../../../actions/week-admin-actions.ts';
import {
  markAttendance,
  placeSubstitute,
} from '../../../actions/shift-actions.ts';

export interface Person {
  id: string;
  name: string;
  classYear: string;
  points: number;
  exempt: boolean;
}

export interface SlotView {
  slotId: string;
  date: string;
  meal: 'lunch' | 'dinner';
  size: number;
  assignments: {
    id: string;
    memberId: string;
    memberName: string;
    classYear: string;
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
  status,
  hasStarted,
}: {
  weekId: string;
  weekStart: string;
  status: string;
  hasStarted: boolean;
}) {
  const { pending, msg, bad, run } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="card card-pad">
      <div className="wk-status">
        <span className={`tag ${status === 'posted' ? 'ok' : 'locked'}`}>
          {status}
        </span>
        {hasStarted && <span className="tag bad">already started</span>}
      </div>

      {status === 'posted' && !hasStarted && (
        <div className="detail-hint" style={{ marginTop: 8 }}>
          The house can see this week right now. Unpublishing hides it so you
          can fix it, then repost.
        </div>
      )}

      {hasStarted && (
        <div className="alert warn" style={{ marginTop: 10 }}>
          <span className="alert-title">This week has already begun</span>
          <span className="alert-body">
            Brothers have worked shifts from it, so it cannot be unpublished or
            deleted. Edit individual shifts below — each change is logged.
          </span>
        </div>
      )}

      <div className="row-actions">
        {status === 'posted' ? (
          <button
            className="btn"
            disabled={pending || hasStarted}
            onClick={() => run(() => adminUnpublishWeek(weekId))}
          >
            Unpublish — hide from the house
          </button>
        ) : (
          <>
            <button
              className="btn gold"
              disabled={pending}
              onClick={() => run(() => adminRepublishWeek(weekId, weekStart))}
            >
              Post to the house
            </button>
            <button
              className="btn"
              disabled={pending}
              onClick={() => run(() => adminRegenerateWeek(weekStart))}
            >
              Redraw from scratch
            </button>
            {!confirmDelete ? (
              <button
                className="btn danger"
                disabled={pending || hasStarted}
                onClick={() => setConfirmDelete(true)}
              >
                Delete week
              </button>
            ) : (
              <>
                <button
                  className="btn danger-on"
                  disabled={pending}
                  onClick={() => run(() => adminDeleteWeek(weekId))}
                >
                  Really delete — this cannot be undone
                </button>
                <button className="btn" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            )}
          </>
        )}
      </div>

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

function PersonPicker({
  roster,
  onPick,
  disabled,
  placeholder,
}: {
  roster: Person[];
  onPick: (id: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [q, setQ] = useState('');

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return roster.filter((m) => m.name.toLowerCase().includes(s)).slice(0, 6);
  }, [q, roster]);

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
          {matches.map((m) => (
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
              <span className={`tag ${m.classYear === 'junior' ? 'jun' : 'soph'}`}>
                {m.classYear === 'junior' ? 'lunch' : 'dinner'}
              </span>
              <span className="roster-pts mono">{m.points}</span>
              {m.exempt && <span className="tag locked">exempt</span>}
            </button>
          ))}
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
  const [panel, setPanel] = useState<{ id: string; kind: 'replace' | 'sub' } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [anyYear, setAnyYear] = useState(false);
  const [bounty, setBounty] = useState(1);

  const openSeats = slot.size - slot.assignments.length;
  const wantYear = slot.meal === 'lunch' ? 'junior' : 'sophomore';
  const eligible = roster.filter((m) => anyYear || m.classYear === wantYear);

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

          <div className="slot-person-actions">
            <button
              className="btn sm"
              disabled={pending}
              onClick={() =>
                setPanel(
                  panel?.id === a.id && panel.kind === 'replace'
                    ? null
                    : { id: a.id, kind: 'replace' },
                )
              }
            >
              Replace
            </button>
            <button
              className="btn sm"
              disabled={pending}
              onClick={() =>
                setPanel(
                  panel?.id === a.id && panel.kind === 'sub'
                    ? null
                    : { id: a.id, kind: 'sub' },
                )
              }
            >
              {a.coveredByName ? 'Change sub' : 'Add sub'}
            </button>
            <button
              className="btn sm danger"
              disabled={pending}
              onClick={() => run(() => adminRemove(a.id))}
            >
              Remove
            </button>
          </div>

          {panel?.id === a.id && (
            <div className="slot-edit-panel">
              {panel.kind === 'replace' ? (
                <>
                  <div className="panel-explain">
                    <strong>Replace</strong> swaps who is on this shift outright.{' '}
                    {a.memberName} keeps their place in the rotation and owes
                    nothing.
                  </div>
                  <label className="any-year">
                    <input
                      type="checkbox"
                      checked={anyYear}
                      onChange={(e) => setAnyYear(e.target.checked)}
                    />
                    Allow any class year (normally {wantYear}s only)
                  </label>
                  <PersonPicker
                    roster={eligible}
                    disabled={pending}
                    placeholder={`Replace ${a.memberName} with…`}
                    onPick={(id) =>
                      run(async () => {
                        const r = await adminReassign(a.id, id, anyYear);
                        if (r.ok) setPanel(null);
                        return r;
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <div className="panel-explain">
                    <strong>Sub</strong> means somebody covers for{' '}
                    {a.memberName}. Only the sub earns the point, and{' '}
                    {a.memberName} still owes their normal turn.
                  </div>
                  <div className="bounty-row">
                    <span className="bounty-label">Award</span>
                    {[1, 2, 3].map((m) => (
                      <button
                        key={m}
                        className={`btn sm${bounty === m ? ' gold' : ''}`}
                        onClick={() => setBounty(m)}
                      >
                        {m}×
                      </button>
                    ))}
                    <span className="bounty-hint">
                      {bounty === 1
                        ? 'Normal credit'
                        : `Bounty — ${bounty} points for stepping up`}
                    </span>
                  </div>
                  <PersonPicker
                    roster={roster}
                    disabled={pending}
                    placeholder="Who is covering?"
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
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {slot.assignments.length === 0 && (
        <div className="slot-empty">Nobody assigned</div>
      )}

      {openSeats > 0 && (
        <div className="slot-add">
          {!adding ? (
            <button className="btn sm" onClick={() => setAdding(true)}>
              + Add someone
            </button>
          ) : (
            <div className="slot-edit-panel">
              <label className="any-year">
                <input
                  type="checkbox"
                  checked={anyYear}
                  onChange={(e) => setAnyYear(e.target.checked)}
                />
                Allow any class year (normally {wantYear}s only)
              </label>
              <PersonPicker
                roster={eligible}
                disabled={pending}
                placeholder="Who should be on this shift?"
                onPick={(id) =>
                  run(async () => {
                    const r = await adminAdd(slot.slotId, id, anyYear);
                    if (r.ok) setAdding(false);
                    return r;
                  })
                }
              />
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
