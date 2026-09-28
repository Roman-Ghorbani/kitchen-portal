'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { saveCrewDefaults } from '../../../actions/roster-actions.ts';
import { startNextSemester } from '../../../actions/settings-actions.ts';
import { CLASS_YEAR_LABELS, type ClassYear } from '../../../../lib/types.ts';
import type { CrewDefault } from '../../../../lib/roster-plan.ts';

type Status = { ok: boolean; text: string } | null;

const YEARS = Object.keys(CLASS_YEAR_LABELS) as ClassYear[];

/** Where each class year goes when someone is added or imported. */
export function RosterDefaultsForm({ initial }: { initial: Record<ClassYear, CrewDefault> }) {
  const [crews, setCrews] = useState(initial);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = YEARS.some((y) => crews[y] !== initial[y]);

  return (
    <>
      <div className="form-grid">
        {YEARS.map((y) => (
          <label key={y} className="form-field">
            <span>{CLASS_YEAR_LABELS[y]}</span>
            <select
              className="field"
              value={crews[y]}
              onChange={(e) => setCrews({ ...crews, [y]: e.target.value as CrewDefault })}
            >
              <option value="lunch">Lunch crew</option>
              <option value="dinner">Dinner crew</option>
              <option value="exempt">Exempt</option>
            </select>
          </label>
        ))}
      </div>
      <div className="settings-actions">
        <button
          className="btn primary sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const res = await saveCrewDefaults(crews);
              setStatus({ ok: res.ok, text: res.message });
              if (res.ok) router.refresh();
            })
          }
        >
          Save defaults
        </button>
      </div>
      {status && <div className={`form-msg ${status.ok ? 'ok' : 'bad'}`}>{status.text}</div>}
    </>
  );
}

/** The start-of-term switch. Deliberately two steps. */
export function NextSemesterForm({ suggestion }: { suggestion: { name: string; startsOn: string; endsOn: string } }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(suggestion);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <div className="settings-actions">
        <button className="btn sm" onClick={() => setOpen(true)}>
          Start the next semester…
        </button>
        {status && <div className={`form-msg ${status.ok ? 'ok' : 'bad'}`}>{status.text}</div>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await startNextSemester(form);
          setStatus({ ok: res.ok, text: res.message });
          if (res.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <div className="form-grid">
        <label className="form-field">
          <span>Name</span>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Spring 2027" required />
        </label>
        <label className="form-field">
          <span>First day</span>
          <input className="field" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} required />
        </label>
        <label className="form-field">
          <span>Last day</span>
          <input className="field" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} required />
        </label>
      </div>
      <p className="settings-hint">
        Carries over: the roster, everyone’s points and make-up shifts, meal days,
        crew sizes and late-plate settings. Starts fresh: standing conflicts
        (brothers re-enter them for their new classes). The current semester’s
        weeks stay in the record.
      </p>
      <div className="settings-actions">
        <button className="btn primary sm" type="submit" disabled={pending}>
          {pending ? 'Starting…' : `Start ${form.name || 'the semester'}`}
        </button>
        <button className="btn sm alt" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {status && <div className={`form-msg ${status.ok ? 'ok' : 'bad'}`}>{status.text}</div>}
    </form>
  );
}
