'use client';

/**
 * Everything the manager can change about one brother, as four cards:
 * profile, duty, points, and account (sign-in and roster membership).
 * Every save goes through a server action that writes the audit log.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  updateMemberProfile,
  setDuty,
  adjustPoints,
  setMakeupDebt,
  setActive,
  deleteMember,
} from '../../../../actions/roster-actions.ts';
import { issueSetupCode, resetMemberPin, type IssuedCode } from '../../../../actions/auth-actions.ts';
import { SetupCodes } from '../../roster/setup-codes.tsx';
import {
  CLASS_YEAR_LABELS,
  CREW_LABELS,
  EXEMPT_REASON_LABELS,
  formatPoints,
  type ClassYear,
  type ExemptReason,
  type Meal,
} from '../../../../../lib/types.ts';

export interface EditableMember {
  id: string;
  name: string;
  classYear: ClassYear;
  rotation: Meal;
  room: string | null;
  pledgeClass: string | null;
  slackUserId: string | null;
  managerNotes: string | null;
  exempt: boolean;
  exemptReason: ExemptReason | null;
  exemptNotes: string | null;
  points: number;
  makeupDebt: number;
  hasPin: boolean;
  active: boolean;
  /** Never scheduled, so deleting him loses nothing. */
  deletable: boolean;
}

type Result = { ok: boolean; message: string };

function useAction() {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Result | null>(null);
  const router = useRouter();
  const run = (work: () => Promise<Result>, after?: (r: Result) => void, refresh = true) =>
    start(async () => {
      const res = await work();
      setStatus(res);
      if (res.ok && refresh) router.refresh();
      after?.(res);
    });
  const msg = status && (
    <div className={`form-msg ${status.ok ? 'ok' : 'bad'}`} role={status.ok ? 'status' : 'alert'}>
      {status.message}
    </div>
  );
  return { pending, run, msg };
}

export function MemberControls({ member }: { member: EditableMember }) {
  return (
    <div className="profile-grid">
      <ProfileCard member={member} />
      <DutyCard member={member} />
      <PointsCard member={member} />
      <AccountCard member={member} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProfileCard({ member }: { member: EditableMember }) {
  const { pending, run, msg } = useAction();
  const [form, setForm] = useState({
    name: member.name,
    classYear: member.classYear,
    room: member.room ?? '',
    pledgeClass: member.pledgeClass ?? '',
    slackUserId: member.slackUserId ?? '',
    managerNotes: member.managerNotes ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="card card-pad"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateMemberProfile(member.id, form as typeof form & { classYear: ClassYear }));
      }}
    >
      <h2 className="section-title">Profile</h2>
      <div className="form-grid">
        <label className="form-field span-2">
          <span>Name</span>
          <input className="field" value={form.name} onChange={set('name')} maxLength={60} required />
        </label>
        <label className="form-field">
          <span>Class year</span>
          <select className="field" value={form.classYear} onChange={set('classYear')}>
            {(Object.keys(CLASS_YEAR_LABELS) as ClassYear[]).map((y) => (
              <option key={y} value={y}>
                {CLASS_YEAR_LABELS[y]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Room</span>
          <input className="field" value={form.room} onChange={set('room')} maxLength={20} />
        </label>
        <label className="form-field">
          <span>Pledge class</span>
          <input className="field" value={form.pledgeClass} onChange={set('pledgeClass')} maxLength={40} />
        </label>
        <label className="form-field">
          <span>Slack member ID</span>
          <input className="field mono" value={form.slackUserId} onChange={set('slackUserId')} placeholder="U01ABC23DEF" maxLength={16} />
        </label>
        <label className="form-field span-2">
          <span>Manager notes <em>only you see these</em></span>
          <textarea className="field" rows={2} value={form.managerNotes} onChange={set('managerNotes')} maxLength={1000} />
        </label>
      </div>
      <p className="settings-hint">
        Class year is for your reference; his crew (next card) decides the meal.
        He can edit his own room and Slack ID from his Profile page.
      </p>
      <div className="settings-actions">
        <button className="btn primary sm" type="submit" disabled={pending}>
          Save profile
        </button>
      </div>
      {msg}
    </form>
  );
}

/* ------------------------------------------------------------------ */

function DutyCard({ member }: { member: EditableMember }) {
  const { pending, run, msg } = useAction();
  const [reason, setReason] = useState<ExemptReason>(member.exemptReason ?? (member.classYear === 'senior' ? 'senior' : 'officer'));
  const [notes, setNotes] = useState(member.exemptNotes ?? '');

  return (
    <section className="card card-pad">
      <h2 className="section-title">Duty</h2>
      <p className="settings-lede">
        Now:{' '}
        <strong>
          {member.exempt
            ? `Exempt · ${EXEMPT_REASON_LABELS[member.exemptReason ?? 'other']}`
            : CREW_LABELS[member.rotation]}
        </strong>
        {member.exempt && member.exemptNotes ? ` - ${member.exemptNotes}` : ''}
      </p>
      <div className="choice-row">
        {(['lunch', 'dinner'] as const).map((crew) => (
          <button
            key={crew}
            className={`btn sm${!member.exempt && member.rotation === crew ? ' is-on' : ''}`}
            disabled={pending || (!member.exempt && member.rotation === crew)}
            onClick={() => run(() => setDuty([member.id], { kind: 'crew', crew }))}
          >
            {CREW_LABELS[crew]}
          </button>
        ))}
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="form-field">
          <span>Exempt because</span>
          <select className="field" value={reason} onChange={(e) => setReason(e.target.value as ExemptReason)}>
            {(Object.keys(EXEMPT_REASON_LABELS) as ExemptReason[]).map((r) => (
              <option key={r} value={r}>
                {EXEMPT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Note <em>optional</em></span>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        </label>
      </div>
      <div className="settings-actions">
        <button className="btn sm" disabled={pending} onClick={() => run(() => setDuty([member.id], { kind: 'exempt', reason, notes }))}>
          {member.exempt ? 'Update exemption' : 'Exempt him'}
        </button>
      </div>
      <p className="settings-hint">
        {member.exempt
          ? `Exempt - never drawn. Choosing a crew puts him back on duty (${CREW_LABELS[member.rotation].toLowerCase()} last).`
          : 'Changes apply to weeks drawn from now on; posted weeks are not touched.'}
      </p>
      {msg}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PointsCard({ member }: { member: EditableMember }) {
  const { pending, run, msg } = useAction();
  const [delta, setDelta] = useState('1');
  const [reason, setReason] = useState('');
  const [debt, setDebt] = useState(String(member.makeupDebt));
  const n = Number(delta);

  return (
    <section className="card card-pad">
      <h2 className="section-title">Points</h2>
      <dl className="profile-facts">
        <dt>Points</dt>
        <dd className="mono">{formatPoints(member.points)}</dd>
        <dt>Make-up owed</dt>
        <dd className="mono">{member.makeupDebt}</dd>
      </dl>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="form-field">
          <span>Amount</span>
          <input className="field mono" type="number" step={0.5} min={0.5} max={100} value={delta} onChange={(e) => setDelta(e.target.value)} />
        </label>
        <label className="form-field span-2">
          <span>Why</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Deep clean after the formal" />
        </label>
      </div>
      <div className="settings-actions">
        <button className="btn sm" disabled={pending || !(n > 0) || !reason.trim()} onClick={() => run(() => adjustPoints(member.id, n, reason), (r) => r.ok && setReason(''))}>
          + Add
        </button>
        <button className="btn sm" disabled={pending || !(n > 0) || !reason.trim()} onClick={() => run(() => adjustPoints(member.id, -n, reason), (r) => r.ok && setReason(''))}>
          − Subtract
        </button>
      </div>

      <div className="debt-row">
        <label className="form-field">
          <span>Make-up shifts owed</span>
          <input className="field mono" type="number" min={0} max={10} step={1} value={debt} onChange={(e) => setDebt(e.target.value)} />
        </label>
        <button
          className="btn sm"
          disabled={pending || Number(debt) === member.makeupDebt}
          onClick={() => run(() => setMakeupDebt(member.id, Number(debt)))}
        >
          Set
        </button>
      </div>
      <p className="settings-hint">Fewer points means drawn sooner. Make-up shifts come before everything else.</p>
      {msg}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function AccountCard({ member }: { member: EditableMember }) {
  const { pending, run, msg } = useAction();
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [confirm, setConfirm] = useState<null | 'reset' | 'off' | 'delete'>(null);
  const router = useRouter();

  const withCode = (work: () => Promise<Result & { issued?: IssuedCode }>) =>
    run(async () => {
      const res = await work();
      if (res.issued) setIssued(res.issued);
      return res;
    });

  return (
    <section className="card card-pad">
      <h2 className="section-title">Account</h2>
      <dl className="profile-facts">
        <dt>Sign-in</dt>
        <dd>{member.hasPin ? 'PIN set' : 'Not claimed yet'}</dd>
        <dt>Roster</dt>
        <dd>{member.active ? 'On the roster' : 'Off the roster'}</dd>
      </dl>

      {issued && <SetupCodes codes={[issued]} onDone={() => setIssued(null)} />}

      <div className="settings-actions">
        {!member.hasPin ? (
          <button className="btn sm" disabled={pending || !member.active} onClick={() => withCode(() => issueSetupCode(member.id))}>
            Issue setup code
          </button>
        ) : confirm === 'reset' ? (
          <>
            <button className="btn sm danger" disabled={pending} onClick={() => { setConfirm(null); withCode(() => resetMemberPin(member.id)); }}>
              Yes, reset his PIN
            </button>
            <button className="btn sm alt" onClick={() => setConfirm(null)}>Cancel</button>
          </>
        ) : (
          <button className="btn sm" disabled={pending} onClick={() => setConfirm('reset')}>
            Reset forgotten PIN
          </button>
        )}
      </div>
      <p className="settings-hint">
        {member.hasPin
          ? 'A reset clears his PIN, signs him out everywhere and gives you a new setup code - also the fix if he thinks someone else knows his PIN.'
          : 'He needs a one-time setup code to claim his account. Issuing a new one cancels any earlier code.'}
      </p>

      <div className="settings-actions">
        {member.active ? (
          confirm === 'off' ? (
            <>
              <button className="btn sm danger" disabled={pending} onClick={() => { setConfirm(null); run(() => setActive([member.id], false)); }}>
                Yes, take him off
              </button>
              <button className="btn sm alt" onClick={() => setConfirm(null)}>Cancel</button>
            </>
          ) : (
            <button className="btn sm" disabled={pending} onClick={() => setConfirm('off')}>
              Take off the roster
            </button>
          )
        ) : (
          <button className="btn sm primary" disabled={pending} onClick={() => run(() => setActive([member.id], true))}>
            Put back on the roster
          </button>
        )}
        {member.deletable &&
          (confirm === 'delete' ? (
            <>
              <button
                className="btn sm danger"
                disabled={pending}
                onClick={() => run(() => deleteMember(member.id), (r) => r.ok && router.push('/admin/roster'), false)}
              >
                Yes, delete for good
              </button>
              <button className="btn sm alt" onClick={() => setConfirm(null)}>Cancel</button>
            </>
          ) : (
            <button className="btn sm alt" disabled={pending} onClick={() => setConfirm('delete')}>
              Delete
            </button>
          ))}
      </div>
      <p className="settings-hint">
        Off the roster is for graduating or moving out: history and points are
        kept and he is signed out.
        {member.deletable && ' Delete is only for a mistake - he has never been scheduled.'}
      </p>
      {msg}
    </section>
  );
}
