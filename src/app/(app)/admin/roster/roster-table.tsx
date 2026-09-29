'use client';

/**
 * The roster list. Pick people with the checkboxes and act on all of them at
 * once from the bar that appears, or open anyone's page for the rest.
 *
 * The two panels above the list - adding a person and adjusting points -
 * are the manager's everyday tools, so they sit here rather than in Settings.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  addMember,
  setDuty,
  setActive,
  previewBulkPoints,
  applyBulkPoints,
} from '../../../actions/roster-actions.ts';
import { issueSetupCode, issueSetupCodesForAll, type IssuedCode } from '../../../actions/auth-actions.ts';
import { SetupCodes } from './setup-codes.tsx';
import {
  CLASS_YEAR_LABELS,
  ROTATION_LABELS,
  EXEMPT_REASON_LABELS,
  formatPoints,
  type ClassYear,
  type ExemptReason,
  type Meal,
} from '../../../../lib/types.ts';
import { POINT_OP_LABELS, checkAmount, type PointOp, type PointsPlan } from '../../../../lib/points-ops.ts';
import type { CrewDefault } from '../../../../lib/roster-plan.ts';

export interface RosterRow {
  id: string;
  name: string;
  classYear: ClassYear;
  rotation: Meal;
  room: string | null;
  points: number;
  makeupDebt: number;
  exempt: boolean;
  exemptReason: ExemptReason | null;
  hasPin: boolean;
  active: boolean;
  standingConflicts: number;
}

type Filter = 'roster' | 'lunch' | 'dinner' | 'exempt' | 'no-pin' | 'owing' | 'off';
type Sort = 'name' | 'points-desc' | 'points-asc' | 'year' | 'room';
type Panel = null | 'add' | 'points' | 'exempt';
type Scope = 'selected' | 'on-duty' | 'lunch' | 'dinner' | 'everyone';

const FILTERS: { key: Filter; label: string; test: (r: RosterRow) => boolean }[] = [
  { key: 'roster', label: 'On the roster', test: (r) => r.active },
  { key: 'lunch', label: 'Lunch rotation', test: (r) => r.active && !r.exempt && r.rotation === 'lunch' },
  { key: 'dinner', label: 'Dinner rotation', test: (r) => r.active && !r.exempt && r.rotation === 'dinner' },
  { key: 'exempt', label: 'Exempt', test: (r) => r.active && r.exempt },
  { key: 'no-pin', label: 'No PIN', test: (r) => r.active && !r.hasPin },
  { key: 'owing', label: 'Owes make-up', test: (r) => r.active && r.makeupDebt > 0 },
  { key: 'off', label: 'Off roster', test: (r) => !r.active },
];

const YEAR_ORDER = Object.keys(CLASS_YEAR_LABELS) as ClassYear[];

const SCOPE_LABELS: Record<Scope, string> = {
  selected: 'Selected brothers',
  'on-duty': 'Everyone on duty',
  lunch: 'Lunch rotation',
  dinner: 'Dinner rotation',
  everyone: 'Everyone on the roster, exempt too',
};

function dutyTag(r: Pick<RosterRow, 'exempt' | 'exemptReason' | 'rotation'>) {
  if (r.exempt) {
    return <span className="tag locked">Exempt · {EXEMPT_REASON_LABELS[r.exemptReason ?? 'other']}</span>;
  }
  return <span className={`tag ${r.rotation === 'lunch' ? 'jun' : 'soph'}`}>{ROTATION_LABELS[r.rotation]}</span>;
}

export function RosterTable({
  rows,
  crewDefaults,
}: {
  rows: RosterRow[];
  crewDefaults: Record<ClassYear, CrewDefault>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('roster');
  const [sort, setSort] = useState<Sort>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [codes, setCodes] = useState<IssuedCode[]>([]);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<Filter, number>,
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const list = rows.filter(
      (r) => test(r) && (!q || r.name.toLowerCase().includes(q) || (r.room ?? '').toLowerCase().includes(q)),
    );
    const byName = (a: RosterRow, b: RosterRow) => a.name.localeCompare(b.name);
    return list.sort((a, b) => {
      switch (sort) {
        case 'points-desc':
          return b.points - a.points || byName(a, b);
        case 'points-asc':
          return a.points - b.points || byName(a, b);
        case 'year':
          return YEAR_ORDER.indexOf(a.classYear) - YEAR_ORDER.indexOf(b.classYear) || byName(a, b);
        case 'room':
          return (a.room ?? '~').localeCompare(b.room ?? '~', undefined, { numeric: true }) || byName(a, b);
        default:
          return byName(a, b);
      }
    });
  }, [rows, query, filter, sort]);

  // Selection only ever holds people who are currently visible, so a bulk
  // action never reaches someone the manager cannot see.
  const visibleIds = useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  const picked = [...selected].filter((id) => visibleIds.has(id));
  const pickedRows = shown.filter((r) => selected.has(r.id));
  const allPicked = shown.length > 0 && picked.length === shown.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function run(work: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await work();
      setStatus({ ok: res.ok, text: res.message });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  const clearSelection = () => {
    setSelected(new Set());
    setConfirmOff(false);
  };

  return (
    <>
      <div className="card card-pad roster-toolbar-card">
        <div className="roster-toolbar-row">
          <input
            className="field roster-search"
            placeholder="Search by name or room"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the roster"
          />
          <select className="field roster-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="name">Name</option>
            <option value="points-desc">Most points</option>
            <option value="points-asc">Fewest points</option>
            <option value="year">Class year</option>
            <option value="room">Room</option>
          </select>
          <button className={`btn sm${panel === 'add' ? ' primary' : ''}`} onClick={() => setPanel(panel === 'add' ? null : 'add')}>
            + Add a brother
          </button>
          <button className={`btn sm${panel === 'points' ? ' primary' : ''}`} onClick={() => setPanel(panel === 'points' ? null : 'points')}>
            Adjust points
          </button>
        </div>

        <div className="filter-chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`filter-chip${filter === f.key ? ' active' : ''}`}
              onClick={() => {
                setFilter(f.key);
                clearSelection();
              }}
            >
              {f.label}
              <span className="chip-count mono">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {panel === 'add' && (
        <AddMemberPanel
          crewDefaults={crewDefaults}
          pending={pending}
          onClose={() => setPanel(null)}
          onAdd={(input, wantCode) =>
            run(async () => {
              const res = await addMember(input);
              if (res.ok && res.id && wantCode) {
                const code = await issueSetupCode(res.id);
                if (code.issued) setCodes([code.issued]);
              }
              return res;
            })
          }
        />
      )}

      {panel === 'points' && (
        <PointsPanel
          selectedIds={picked}
          onClose={() => setPanel(null)}
          onDone={(res) => {
            setStatus({ ok: res.ok, text: res.message });
            if (res.ok) {
              setPanel(null);
              router.refresh();
            }
          }}
        />
      )}

      {panel === 'exempt' && picked.length > 0 && (
        <ExemptPanel
          count={picked.length}
          pending={pending}
          onClose={() => setPanel(null)}
          onApply={(reason, notes) =>
            run(() => setDuty(picked, { kind: 'exempt', reason, notes }), () => {
              setPanel(null);
              clearSelection();
            })
          }
        />
      )}

      {status && (
        <div className={`form-msg ${status.ok ? 'ok' : 'bad'}`} role={status.ok ? 'status' : 'alert'}>
          {status.text}
        </div>
      )}

      {codes.length > 0 && <SetupCodes codes={codes} onDone={() => setCodes([])} />}

      <div className="roster-grid" role="table" aria-label="Roster">
        <div className="roster-grid-head" role="row">
          <label className="roster-check" title="Select everyone shown">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setSelected(allPicked ? new Set() : new Set(shown.map((r) => r.id)))}
              aria-label="Select everyone shown"
            />
          </label>
          <span>Name</span>
          <span className="rg-col-year">Class</span>
          <span>Duty</span>
          <span className="rg-col-room">Room</span>
          <span className="rg-col-pts">Points</span>
          <span className="rg-col-flags" />
        </div>

        {shown.map((r) => (
          <div
            key={r.id}
            role="row"
            className={`roster-grid-row${selected.has(r.id) ? ' is-picked' : ''}${!r.active ? ' is-off' : ''}`}
          >
            <label className="roster-check">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
            </label>
            <Link className="rg-name" href={`/admin/member/${r.id}`}>
              {r.name}
            </Link>
            <span className="rg-col-year">{CLASS_YEAR_LABELS[r.classYear]}</span>
            <span>{dutyTag(r)}</span>
            <span className="rg-col-room mono">{r.room ?? '—'}</span>
            <span className="rg-col-pts mono">{formatPoints(r.points)}</span>
            <span className="rg-col-flags">
              {r.makeupDebt > 0 && <span className="tag bad">owes {r.makeupDebt}</span>}
              {r.active && !r.hasPin && <span className="tag bad">no PIN</span>}
              {r.standingConflicts > 0 && (
                <span className="tag ok" title="Standing conflicts this semester">
                  {r.standingConflicts} busy
                </span>
              )}
              {!r.active && <span className="tag locked">off roster</span>}
            </span>
          </div>
        ))}

        {shown.length === 0 && <div className="roster-empty">Nobody matches.</div>}
      </div>

      <p className="note">
        Select people to move them between rotations, exempt them, adjust their
        points or take them off the roster. Open a name for his profile, sign-in
        and full history. Every change is written to the audit log.
      </p>

      {picked.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected brothers">
          <span className="bulk-count">
            <strong>{picked.length}</strong> selected
          </span>
          {filter === 'off' ? (
            <button className="btn sm primary" disabled={pending} onClick={() => run(() => setActive(picked, true), clearSelection)}>
              Put back on the roster
            </button>
          ) : (
            <>
              <button className="btn sm" disabled={pending} onClick={() => run(() => setDuty(picked, { kind: 'crew', crew: 'lunch' }), clearSelection)}>
                → Lunch rotation
              </button>
              <button className="btn sm" disabled={pending} onClick={() => run(() => setDuty(picked, { kind: 'crew', crew: 'dinner' }), clearSelection)}>
                → Dinner rotation
              </button>
              <button className="btn sm" disabled={pending} onClick={() => setPanel('exempt')}>
                Exempt…
              </button>
              <button className="btn sm" disabled={pending} onClick={() => setPanel('points')}>
                Points…
              </button>
              {pickedRows.some((r) => !r.hasPin) && (
                <button
                  className="btn sm"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await issueSetupCodesForAll(picked);
                      setCodes(res.issued);
                      return res;
                    }, clearSelection)
                  }
                >
                  Setup codes
                </button>
              )}
              {confirmOff ? (
                <>
                  <span className="bulk-warn">History and points are kept.</span>
                  <button
                    className="btn sm danger"
                    disabled={pending}
                    onClick={() => run(() => setActive(picked, false), () => { clearSelection(); setConfirmOff(false); })}
                  >
                    Yes, take {picked.length} off
                  </button>
                </>
              ) : (
                <button className="btn sm danger" disabled={pending} onClick={() => setConfirmOff(true)}>
                  Take off roster
                </button>
              )}
            </>
          )}
          <button className="btn sm alt" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function AddMemberPanel({
  crewDefaults,
  pending,
  onClose,
  onAdd,
}: {
  crewDefaults: Record<ClassYear, CrewDefault>;
  pending: boolean;
  onClose: () => void;
  onAdd: (
    input: { name: string; classYear: ClassYear; duty?: CrewDefault; room?: string; pledgeClass?: string },
    wantCode: boolean,
  ) => void;
}) {
  const [name, setName] = useState('');
  const [classYear, setClassYear] = useState<ClassYear>('sophomore');
  const [duty, setDutyChoice] = useState<'' | CrewDefault>('');
  const [room, setRoom] = useState('');
  const [pledgeClass, setPledgeClass] = useState('');
  const [wantCode, setWantCode] = useState(true);

  const fallback = crewDefaults[classYear];
  const defaultLabel = fallback === 'exempt' ? 'exempt' : ROTATION_LABELS[fallback].toLowerCase();

  return (
    <form
      className="card card-pad roster-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ name, classYear, duty: duty || undefined, room, pledgeClass }, wantCode);
        setName('');
        setRoom('');
        setPledgeClass('');
        setDutyChoice('');
      }}
    >
      <div className="roster-panel-head">
        <h2 className="section-title">Add a brother</h2>
        <button type="button" className="btn sm alt" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="form-grid">
        <label className="form-field span-2">
          <span>Full name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} autoFocus />
        </label>
        <label className="form-field">
          <span>Class year</span>
          <select className="field" value={classYear} onChange={(e) => setClassYear(e.target.value as ClassYear)}>
            {YEAR_ORDER.map((y) => (
              <option key={y} value={y}>
                {CLASS_YEAR_LABELS[y]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Duty</span>
          <select className="field" value={duty} onChange={(e) => setDutyChoice(e.target.value as '' | CrewDefault)}>
            <option value="">Default for the year ({defaultLabel})</option>
            <option value="lunch">Lunch rotation</option>
            <option value="dinner">Dinner rotation</option>
            <option value="exempt">Exempt</option>
          </select>
        </label>
        <label className="form-field">
          <span>Room <em>optional</em></span>
          <input className="field" value={room} onChange={(e) => setRoom(e.target.value)} maxLength={20} />
        </label>
        <label className="form-field">
          <span>Pledge class <em>optional</em></span>
          <input className="field" value={pledgeClass} onChange={(e) => setPledgeClass(e.target.value)} maxLength={40} />
        </label>
      </div>
      <label className="check-inline">
        <input type="checkbox" checked={wantCode} onChange={(e) => setWantCode(e.target.checked)} />
        Give me his setup code now
      </label>
      <p className="settings-hint">
        He starts level with the lowest score on his rotation, so he is not first in
        line for every shift. Adding many people? Use the Import tab.
      </p>
      <div className="settings-actions">
        <button className="btn primary sm" type="submit" disabled={pending || name.trim().length < 2}>
          {pending ? 'Adding…' : 'Add to roster'}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function ExemptPanel({
  count,
  pending,
  onClose,
  onApply,
}: {
  count: number;
  pending: boolean;
  onClose: () => void;
  onApply: (reason: ExemptReason, notes: string) => void;
}) {
  const [reason, setReason] = useState<ExemptReason>('senior');
  const [notes, setNotes] = useState('');
  return (
    <form
      className="card card-pad roster-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(reason, notes);
      }}
    >
      <div className="roster-panel-head">
        <h2 className="section-title">
          Exempt {count} brother{count === 1 ? '' : 's'}
        </h2>
        <button type="button" className="btn sm alt" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="form-grid">
        <label className="form-field">
          <span>Reason</span>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as ExemptReason)}>
            {(Object.keys(EXEMPT_REASON_LABELS) as ExemptReason[]).map((r) => (
              <option key={r} value={r}>
                {EXEMPT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field span-2">
          <span>Note <em>optional</em></span>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="e.g. Treasurer, Spring 2027" />
        </label>
      </div>
      <p className="settings-hint">
        Exempt brothers are never drawn and keep their points. They keep their
        rotation too, so lifting the exemption puts them straight back where they were.
      </p>
      <div className="settings-actions">
        <button className="btn primary sm" type="submit" disabled={pending}>
          Exempt
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function PointsPanel({
  selectedIds,
  onClose,
  onDone,
}: {
  selectedIds: string[];
  onClose: () => void;
  onDone: (res: { ok: boolean; message: string }) => void;
}) {
  const [scope, setScope] = useState<Scope>(selectedIds.length ? 'selected' : 'on-duty');
  const [op, setOp] = useState<PointOp>('add');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ plan?: PointsPlan; message: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const n = op === 'rebase' ? 0 : Number(amount);
  const amountError = checkAmount(op, n);
  const effectiveScope: Scope = scope === 'selected' && !selectedIds.length ? 'on-duty' : scope;

  // Any change to the inputs throws the preview away: what is applied is
  // always what was last previewed.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  return (
    <div className="card card-pad roster-panel">
      <div className="roster-panel-head">
        <h2 className="section-title">Adjust points</h2>
        <button type="button" className="btn sm alt" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="form-grid">
        <label className="form-field span-2">
          <span>Who</span>
          <select className="field" value={effectiveScope} onChange={(e) => reset(setScope)(e.target.value as Scope)}>
            {(Object.keys(SCOPE_LABELS) as Scope[])
              .filter((s) => s !== 'selected' || selectedIds.length)
              .map((s) => (
                <option key={s} value={s}>
                  {s === 'selected' ? `${SCOPE_LABELS[s]} (${selectedIds.length})` : SCOPE_LABELS[s]}
                </option>
              ))}
          </select>
        </label>
        <label className="form-field">
          <span>Change</span>
          <select className="field" value={op} onChange={(e) => reset(setOp)(e.target.value as PointOp)}>
            {(Object.keys(POINT_OP_LABELS) as PointOp[]).map((o) => (
              <option key={o} value={o}>
                {POINT_OP_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        {op !== 'rebase' && (
          <label className="form-field">
            <span>Points</span>
            <input className="field mono" type="number" min={0} max={100} step={0.5} value={amount} onChange={(e) => reset(setAmount)(e.target.value)} />
          </label>
        )}
        <label className="form-field span-2">
          <span>Why (goes on each brother’s record)</span>
          <input
            className="field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="e.g. Rush week kitchen help"
          />
        </label>
      </div>

      <p className="settings-hint">
        Points carry over between semesters. <strong>Rebase</strong> takes the
        lowest score off everybody in the group - the numbers shrink but the
        order and the gaps stay exactly as they were. Points never go below 0.
      </p>

      {preview && (
        <div className={`form-msg ${preview.ok ? 'ok' : 'bad'}`}>{preview.message}</div>
      )}
      {preview?.plan && preview.plan.changes.length > 0 && (
        <div className="points-preview">
          {preview.plan.changes.slice(0, 40).map((c) => (
            <div key={c.id} className="points-preview-row">
              <span>{c.name}</span>
              <span className="mono">
                {formatPoints(c.before)} → <strong>{formatPoints(c.after)}</strong>
              </span>
            </div>
          ))}
          {preview.plan.changes.length > 40 && (
            <div className="points-preview-more">and {preview.plan.changes.length - 40} more</div>
          )}
        </div>
      )}

      <div className="settings-actions">
        <button
          className="btn sm"
          disabled={pending || !!amountError}
          onClick={() =>
            startTransition(async () => {
              setPreview(await previewBulkPoints(effectiveScope, selectedIds, op, n));
            })
          }
        >
          Preview
        </button>
        <button
          className="btn primary sm"
          disabled={pending || !preview?.plan?.changes.length || !reason.trim()}
          onClick={() =>
            startTransition(async () => {
              onDone(await applyBulkPoints(effectiveScope, selectedIds, op, n, reason));
            })
          }
        >
          Apply to {preview?.plan?.changes.length ?? 0}
        </button>
        {amountError && op !== 'rebase' && <span className="settings-hint">{amountError}</span>}
      </div>
    </div>
  );
}
