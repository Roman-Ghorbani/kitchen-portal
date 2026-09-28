'use client';

/**
 * Three steps on one page: give it the roster, answer what it cannot know,
 * then tick the changes to make.
 *
 * The file is read here in the browser for instant feedback (how many names,
 * which columns, which pledge classes need a year), and read again on the
 * server when the preview and the import run - the server never trusts the
 * browser's reading.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { previewRosterImport, applyRosterImport } from '../../../../actions/roster-actions.ts';
import { readRoster, pledgeClassesIn } from '../../../../../lib/roster-intake.ts';
import type { ImportOptions, ImportPlan, CrewDefault } from '../../../../../lib/roster-plan.ts';
import { CLASS_YEAR_LABELS, CREW_LABELS, type ClassYear } from '../../../../../lib/types.ts';

type Preview = Awaited<ReturnType<typeof previewRosterImport>>;

const YEARS = Object.keys(CLASS_YEAR_LABELS) as ClassYear[];

const TEMPLATE =
  'Name,Class year,Room,Crew\n' +
  'Jake Meyerson,Junior,204,\n' +
  'Noah Berger,Sophomore,112,\n' +
  'Ben Cohen,Senior,301,lunch\n';

const EXAMPLE = `Juniors
Jake Meyerson
Aaron Katz
Sophomores
Noah Berger (dinner)
Seniors
Ben Cohen - lunch`;

function placementLabel(p: { rotation: 'lunch' | 'dinner'; exempt: boolean }) {
  return p.exempt ? 'Exempt' : CREW_LABELS[p.rotation];
}

export function ImportWizard({
  rosterSize,
  savedPledgeYears,
  crewDefaults,
}: {
  rosterSize: number;
  savedPledgeYears: Record<string, ClassYear | 'skip'>;
  crewDefaults: Record<ClassYear, CrewDefault>;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pledgeYears, setPledgeYears] = useState<Record<string, ClassYear | 'skip'>>(savedPledgeYears);
  const [liveInOnly, setLiveInOnly] = useState(true);
  const [resetCrews, setResetCrews] = useState(false);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipAdd, setSkipAdd] = useState<Set<string>>(new Set());
  const [skipUpdate, setSkipUpdate] = useState<Set<string>>(new Set());
  const [keepRemove, setKeepRemove] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const intake = useMemo(() => (text.trim() ? readRoster(text) : null), [text]);
  const pledgeClasses = useMemo(() => (intake ? pledgeClassesIn(intake) : []), [intake]);
  const unmapped = pledgeClasses.filter((pc) => !pledgeYears[pc]);

  const options: ImportOptions = { pledgeYears, liveInOnly, resetCrews, removeMissing };

  // Anything that changes what would be imported throws the preview away.
  const invalidate = () => {
    setPreview(null);
    setResult(null);
  };

  function loadFile(file: File) {
    if (file.size > 512 * 1024) {
      setResult({ ok: false, message: 'That file is too large to be a roster.' });
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      setResult({
        ok: false,
        message: 'That is an Excel workbook. In Excel or Sheets, use File → Save as / Download → CSV, or select the cells and paste them below.',
      });
      return;
    }
    file.text().then((t) => {
      setText(t);
      setFileName(file.name);
      invalidate();
    });
  }

  function runPreview() {
    startTransition(async () => {
      const res = await previewRosterImport(text, options);
      setPreview(res);
      setSkipAdd(new Set());
      setSkipUpdate(new Set());
      setKeepRemove(new Set());
      setResult(res.ok ? null : { ok: false, message: res.message });
    });
  }

  function runImport(plan: ImportPlan) {
    startTransition(async () => {
      const res = await applyRosterImport(text, options, {
        addKeys: plan.add.filter((a) => !skipAdd.has(a.key)).map((a) => a.key),
        updateIds: plan.update.filter((u) => !skipUpdate.has(u.id)).map((u) => u.id),
        removeIds: plan.remove.filter((r) => !keepRemove.has(r.id)).map((r) => r.id),
      });
      setResult(res);
      if (res.ok) {
        setPreview(null);
        setText('');
        setFileName(null);
        router.refresh();
      }
    });
  }

  const flip = (set: Set<string>, update: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const plan = preview?.plan;
  const chosen = plan
    ? plan.add.length - skipAdd.size + (plan.update.length - skipUpdate.size) + (plan.remove.length - keepRemove.size)
    : 0;

  return (
    <>
      {/* 1. The roster */}
      <section className="card card-pad settings-card">
        <h2 className="section-title">1 · The roster</h2>
        <p className="settings-lede">
          Upload a CSV, paste cells straight from Google Sheets or Excel, or type
          a list - one name per line, with the year after it or under a heading
          like <em>Juniors</em>. Columns are found by their header (name, year,
          pledge class, room, crew) in any order; anything else, like phone
          numbers, is ignored and never stored.
        </p>

        <div className="settings-inline">
          <label className="btn sm">
            Choose a file…
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = '';
              }}
            />
          </label>
          <a className="btn sm alt" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="roster-template.csv">
            Download a template
          </a>
          {fileName && <span className="settings-hint">Loaded {fileName}</span>}
        </div>

        <textarea
          className="field import-text mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
            invalidate();
          }}
          placeholder={EXAMPLE}
          rows={10}
          spellCheck={false}
          aria-label="Roster text"
        />

        {intake && (
          <p className="settings-hint">
            Read as a {intake.format === 'table' ? 'table' : 'list'}: <strong>{intake.rows.length}</strong> name
            {intake.rows.length === 1 ? '' : 's'}
            {intake.format === 'table' &&
              ` · columns found: name${intake.columns.classYear ? ', year' : ''}${intake.columns.pledgeClass ? ', pledge class' : ''}${intake.columns.room ? ', room' : ''}${intake.columns.crew ? ', crew' : ''}`}
            {intake.problems.length > 0 && ` · ${intake.problems.length} line${intake.problems.length === 1 ? '' : 's'} could not be read (listed after the preview)`}
          </p>
        )}
      </section>

      {/* 2. What the file cannot say */}
      {intake && intake.rows.length > 0 && (
        <section className="card card-pad settings-card">
          <h2 className="section-title">2 · Before importing</h2>

          {pledgeClasses.length > 0 && (
            <>
              <p className="settings-lede">
                These people have a pledge class but no year. Say what year each
                pledge class is in now - it is remembered for next time.
              </p>
              <div className="pledge-map">
                {pledgeClasses.map((pc) => (
                  <label key={pc} className="form-field">
                    <span>{pc}</span>
                    <select
                      className="field"
                      value={pledgeYears[pc] ?? ''}
                      onChange={(e) => {
                        setPledgeYears({ ...pledgeYears, [pc]: e.target.value as ClassYear | 'skip' });
                        invalidate();
                      }}
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {YEARS.map((y) => (
                        <option key={y} value={y}>
                          {CLASS_YEAR_LABELS[y]}
                        </option>
                      ))}
                      <option value="skip">Don’t import</option>
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="import-options">
            {intake.columns.room && (
              <label className="check-inline">
                <input type="checkbox" checked={liveInOnly} onChange={(e) => { setLiveInOnly(e.target.checked); invalidate(); }} />
                Only people who live in the house (a room number starting with a digit)
              </label>
            )}
            <label className="check-inline">
              <input type="checkbox" checked={resetCrews} onChange={(e) => { setResetCrews(e.target.checked); invalidate(); }} />
              Put people already on the roster back on their year’s default crew
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={removeMissing} onChange={(e) => { setRemoveMissing(e.target.checked); invalidate(); }} />
              Take anyone not in this roster off the roster (you can tick them individually)
            </label>
          </div>

          <p className="settings-hint">
            New people go on their year’s default crew:{' '}
            {YEARS.filter((y) => y !== 'other')
              .map((y) => `${CLASS_YEAR_LABELS[y].toLowerCase()} → ${crewDefaults[y] === 'exempt' ? 'exempt' : crewDefaults[y]}`)
              .join(', ')}{' '}
            (<Link href="/admin/settings#roster-defaults">change</Link>). A crew column in the file wins.
            People already on the roster keep their crew unless the file gives one.
          </p>

          <div className="settings-actions">
            <button className="btn primary sm" onClick={runPreview} disabled={pending || unmapped.length > 0}>
              {pending && !preview ? 'Reading…' : 'Preview changes'}
            </button>
            {unmapped.length > 0 && <span className="settings-hint">Choose a year for {unmapped.join(', ')} first.</span>}
          </div>
        </section>
      )}

      {result && <div className={`form-msg ${result.ok ? 'ok' : 'bad'}`} role={result.ok ? 'status' : 'alert'}>{result.message}</div>}
      {result?.ok && (
        <p className="settings-hint">
          <Link href="/admin/roster">Back to the roster</Link> ·{' '}
          <Link href="/admin/roster?view=readiness">Issue setup codes</Link>
        </p>
      )}

      {/* 3. The changes */}
      {plan && (
        <section className="card card-pad settings-card">
          <h2 className="section-title">3 · Changes to make</h2>
          <p className="settings-lede">
            Compared with the {rosterSize} people on the roster now. Untick
            anything you do not want. {plan.unchanged > 0 && `${plan.unchanged} already match and are left alone.`}
          </p>

          {plan.add.length > 0 && (
            <>
              <h3 className="subsection-title">Add · {plan.add.length}</h3>
              <div className="import-list">
                {plan.add.map((a) => (
                  <label key={a.key} className="import-row">
                    <input type="checkbox" checked={!skipAdd.has(a.key)} onChange={() => flip(skipAdd, setSkipAdd, a.key)} />
                    <span className="import-name">{a.name}</span>
                    <span className={a.yearGuessed ? 'import-warn' : ''}>
                      {CLASS_YEAR_LABELS[a.classYear]}
                      {a.yearGuessed && ' (no year given)'}
                    </span>
                    <span>{placementLabel(a.placement)}</span>
                    <span className="mono">{a.room ?? ''}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {plan.update.length > 0 && (
            <>
              <h3 className="subsection-title">Update · {plan.update.length}</h3>
              <div className="import-list">
                {plan.update.map((u) => (
                  <label key={u.id} className="import-row">
                    <input type="checkbox" checked={!skipUpdate.has(u.id)} onChange={() => flip(skipUpdate, setSkipUpdate, u.id)} />
                    <span className="import-name">{u.name}</span>
                    <span className="import-changes">
                      {u.changes.map((c) => (
                        <span key={c.field}>
                          {c.field === 'classYear' ? 'year' : c.field === 'pledgeClass' ? 'pledge class' : c.field === 'active' || c.field === 'exempt' || c.field === 'rotation' ? 'duty' : c.field}:{' '}
                          {c.from} → <strong>{c.to}</strong>
                        </span>
                      ))}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {plan.remove.length > 0 && (
            <>
              <h3 className="subsection-title">Take off the roster · {plan.remove.length}</h3>
              <div className="import-list">
                {plan.remove.map((r) => (
                  <label key={r.id} className="import-row">
                    <input type="checkbox" checked={!keepRemove.has(r.id)} onChange={() => flip(keepRemove, setKeepRemove, r.id)} />
                    <span className="import-name">{r.name}</span>
                    <span>not in the file · history and points are kept</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {(plan.skipped.length > 0 || (preview?.intake?.problems.length ?? 0) > 0) && (
            <details className="import-skipped">
              <summary>
                Not imported · {plan.skipped.length + (preview?.intake?.problems.length ?? 0)}
              </summary>
              <ul>
                {plan.skipped.map((s) => (
                  <li key={`s${s.line}`}>
                    Line {s.line}: {s.name} - {s.reason}
                  </li>
                ))}
                {preview?.intake?.problems.map((p) => (
                  <li key={`p${p.line}`}>
                    Line {p.line}: <span className="mono">{p.text}</span> - {p.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="settings-actions">
            <button className="btn primary sm" disabled={pending || chosen === 0} onClick={() => runImport(plan)}>
              {pending ? 'Importing…' : `Make ${chosen} change${chosen === 1 ? '' : 's'}`}
            </button>
            <span className="settings-hint">Each change is written to the audit log.</span>
          </div>
        </section>
      )}
    </>
  );
}
