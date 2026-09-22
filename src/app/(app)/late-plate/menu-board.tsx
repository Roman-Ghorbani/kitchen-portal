'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  requestPlate,
  cancelPlate,
  updateMyDietary,
} from '../../actions/late-plate-actions.ts';
import {
  ALLERGENS,
  DIETARY,
  OTHER_FLAG_ID,
  summariseFlags,
} from '../../../lib/dietary.ts';
import type { RecurringLatePlateRow } from '../../../lib/late-plate-service.ts';
import type { Meal } from '../../../lib/types.ts';
import { RecurringSchedules } from './recurring-schedules.tsx';

/* ------------------------------------------------------------------ */
/* Shapes handed over by the server page                               */
/* ------------------------------------------------------------------ */

export interface BoardRequest {
  id: string;
  status: 'waiting' | 'ready' | 'declined' | 'cancelled';
  askedAt: string | null;
  resolvedAt: string | null;
  flagLines: string[];
  hasAllergen: boolean;
  hasDietary: boolean;
  note: string | null;
  reason: string | null;
}

export interface BoardMeal {
  meal: Meal;
  served: boolean;
  serves: string;
  items: string[];
  menuStale: boolean;
  open: boolean;
  cutoffLabel: string;
  /** Minutes until the cutoff, today only. Null otherwise. */
  minutesLeft: number | null;
  closedReason: string | null;
  request: BoardRequest | null;
}

export interface BoardDay {
  date: string;
  weekday: string;
  short: string;
  dayOfMonth: number;
  isToday: boolean;
  isPast: boolean;
  meals: BoardMeal[];
}

interface Dietary {
  flags: string[];
  other: string;
  lines: string[];
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Never let a flag read as an ingredient. The word is always "allergies" or
 * "restrictions", always "flagged" - never "goes with it".
 */
function flaggedLabel(hasAllergen: boolean, hasDietary: boolean): string {
  if (hasAllergen && hasDietary) return 'Allergies & restrictions flagged';
  if (hasDietary) return 'Restrictions flagged';
  return 'Allergies flagged';
}

function leftLabel(min: number): string {
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`;
}

function isActive(r: BoardRequest | null): boolean {
  return r !== null && (r.status === 'waiting' || r.status === 'ready');
}

function savedFor(day: BoardDay, meal: Meal): string {
  if (day.isToday) return meal === 'dinner' ? 'tonight' : 'lunch today';
  return `${day.weekday} ${meal}`;
}

function recurringLabel(rows: RecurringLatePlateRow[]): string {
  return rows
    .map((r, i) => {
      const txt = `${WEEKDAYS[r.dayOfWeek]} ${r.meal}`;
      return i === 0 ? `Every ${txt}` : txt;
    })
    .join(', ');
}

/* ------------------------------------------------------------------ */
/* Icons (stroke only, currentColor)                                   */
/* ------------------------------------------------------------------ */

const I = {
  plus: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
  ),
  clock: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9.5V13l2 1.5" /></svg>
  ),
  repeat: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
  ),
  left: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
  ),
  right: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
  ),
  close: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
  ),
};

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

type Toast = {
  key: number;
  text: string;
  tone: 'ok' | 'plain' | 'bad';
  undo?: () => void;
};

type Sheet =
  | { kind: 'request'; day: BoardDay; meal: BoardMeal }
  | { kind: 'flags' }
  | { kind: 'recurring' }
  | null;

export function MenuBoard({
  days,
  today,
  weekOffset,
  weekLabel,
  rangeLabel,
  enabled,
  readOnly,
  dietary,
  recurring,
}: {
  days: BoardDay[];
  today: string;
  weekOffset: number;
  weekLabel: string;
  rangeLabel: string;
  enabled: boolean;
  readOnly: boolean;
  dietary: Dietary;
  recurring: RecurringLatePlateRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const defaultDay = useMemo(() => {
    const t = days.find((d) => d.date === today);
    if (t) return t.date;
    const next = days.find((d) => !d.isPast && d.meals.length > 0);
    return (next ?? days[0]).date;
  }, [days, today]);

  const [selected, setSelected] = useState(defaultDay);
  // A new week arrived (week switcher) - jump to its sensible default.
  const weekKey = days[0]?.date;
  useEffect(() => {
    setSelected(defaultDay);
  }, [weekKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const day = days.find((d) => d.date === selected) ?? days[0];

  /* Minutes elapsed since this render, so countdowns tick between refreshes. */
  const mountedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    mountedAt.current = Date.now();
    setElapsed(0);
  }, [days]);
  useEffect(() => {
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - mountedAt.current) / 60_000));
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  /* Latest props, for undo handlers that fire after a refresh. */
  const daysRef = useRef(days);
  daysRef.current = days;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const show = useCallback((t: Omit<Toast, 'key'>) => {
    setToast({ ...t, key: Date.now() });
  }, []);

  function findRequest(date: string, meal: Meal): BoardRequest | null {
    const d = daysRef.current.find((x) => x.date === date);
    return d?.meals.find((m) => m.meal === meal)?.request ?? null;
  }

  /* ---- actions ---- */

  function save(
    target: { day: BoardDay; meal: Meal },
    note: string,
    flags: string[],
    other: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await requestPlate(target.day.date, target.meal, note, flags, other);
        if (!res.ok) {
          show({ text: res.message, tone: 'bad' });
          resolve(false);
          return;
        }
        router.refresh();
        const { date } = target.day;
        const meal = target.meal;
        show({
          text: `Plate saved for ${savedFor(target.day, meal)}`,
          tone: 'ok',
          undo: () => {
            const r = findRequest(date, meal);
            if (!r || r.status !== 'waiting') {
              show({ text: 'Refreshing - try Cancel on the card.', tone: 'plain' });
              router.refresh();
              return;
            }
            startTransition(async () => {
              const u = await cancelPlate(r.id);
              if (!u.ok) show({ text: u.message, tone: 'bad' });
              else {
                setToast(null);
                router.refresh();
              }
            });
          },
        });
        resolve(true);
      });
    });
  }

  function cancel(targetDay: BoardDay, m: BoardMeal) {
    const r = m.request;
    if (!r) return;
    startTransition(async () => {
      const res = await cancelPlate(r.id);
      if (!res.ok) {
        show({ text: res.message, tone: 'bad' });
        return;
      }
      router.refresh();
      show({
        text: `${titleCase(m.meal)} plate cancelled`,
        tone: 'plain',
        undo: () => {
          startTransition(async () => {
            const u = await requestPlate(
              targetDay.date,
              m.meal,
              r.note ?? '',
              dietary.flags,
              dietary.other,
            );
            if (!u.ok) show({ text: u.message, tone: 'bad' });
            else {
              setToast(null);
              router.refresh();
            }
          });
        },
      });
    });
  }

  /* ---- what the week holds for him, for the rail ---- */

  const yourPlates = useMemo(() => {
    const rows: { key: string; label: string; state: string; tone: string }[] = [];
    for (const d of days) {
      for (const m of d.meals) {
        const r = m.request;
        const label = `${d.short} · ${titleCase(m.meal)}`;
        if (r?.status === 'ready') {
          rows.push({ key: d.date + m.meal, label, state: d.isPast ? 'Boxed' : 'In the fridge', tone: 'sage' });
        } else if (r?.status === 'waiting') {
          rows.push({ key: d.date + m.meal, label, state: 'Saved', tone: 'blue' });
        } else if (r?.status === 'declined') {
          rows.push({ key: d.date + m.meal, label, state: 'Declined', tone: 'clay' });
        } else if (
          !d.isPast &&
          recurring.some((x) => x.dayOfWeek === days.indexOf(d) && x.meal === m.meal)
        ) {
          rows.push({ key: d.date + m.meal, label, state: 'Every week', tone: 'ink' });
        }
      }
    }
    return rows;
  }, [days, recurring]);

  const dietarySummary = dietary.lines.length > 0 ? dietary.lines.join(' · ') : null;

  const recurringRow = (
    <button
      type="button"
      className="mb-recurring"
      onClick={() => setSheet({ kind: 'recurring' })}
      disabled={readOnly}
    >
      <span className="mb-recurring-icon">{I.repeat}</span>
      <span className="mb-recurring-text">
        {recurring.length > 0 ? recurringLabel(recurring) : 'No recurring plate'}
      </span>
      {!readOnly && (
        <span className="mb-link">{recurring.length > 0 ? 'Manage' : 'Set one up'}</span>
      )}
    </button>
  );

  return (
    <div className="mb">
      <div className="mb-main">
        <div className="mb-weekrow">
          <div className="mb-week" role="group" aria-label="Week">
            {weekOffset > 0 ? (
              <Link href="/late-plate" className="mb-week-btn" aria-label="This week">
                {I.left}
              </Link>
            ) : (
              <span className="mb-week-btn is-off" aria-hidden="true">{I.left}</span>
            )}
            <span className="mb-week-label">
              {weekLabel}
              <span className="mb-week-range"> · {rangeLabel}</span>
            </span>
            {weekOffset === 0 ? (
              <Link href="/late-plate?week=next" className="mb-week-btn" aria-label="Next week">
                {I.right}
              </Link>
            ) : (
              <span className="mb-week-btn is-off" aria-hidden="true">{I.right}</span>
            )}
          </div>
        </div>

        <div className="mb-days" role="tablist" aria-label="Day">
          {days.map((d) => {
            const has = d.meals.some((m) => isActive(m.request));
            const none = d.meals.length === 0;
            const on = d.date === selected;
            return (
              <button
                key={d.date}
                type="button"
                role="tab"
                aria-selected={on}
                className={`mb-day${on ? ' is-on' : ''}${none ? ' is-none' : ''}${d.isPast ? ' is-past' : ''}`}
                onClick={() => setSelected(d.date)}
              >
                {d.isToday && <span className="mb-today">TODAY</span>}
                <span className="mb-dow">{d.short}</span>
                <span className="mb-dat">{d.dayOfMonth}</span>
                {none && <span className="mb-noservice">No service</span>}
                <span className={`mb-pip${has ? (d.isToday ? ' is-today' : ' is-yours') : ''}`} />
              </button>
            );
          })}
        </div>

        {!day.isToday && (
          <div className="mb-dayhead">
            {day.weekday} {day.dayOfMonth}
            {day.isPast && <span> · earlier this week</span>}
          </div>
        )}

        {day.meals.length === 0 ? (
          <div className="mb-empty">No service on {day.weekday}.</div>
        ) : (
          <div className="mb-meals">
            {day.meals.map((m) => (
              <MealCard
                key={m.meal}
                day={day}
                m={m}
                elapsed={elapsed}
                enabled={enabled}
                readOnly={readOnly}
                pending={pending}
                onSave={() => setSheet({ kind: 'request', day, meal: m })}
                onCancel={() => cancel(day, m)}
              />
            ))}
          </div>
        )}

        <div className="mb-only-narrow">{recurringRow}</div>
      </div>

      <aside className="mb-rail">
        <div className="mb-rail-card">
          <span className="mb-eyebrow">Your plates this week</span>
          {yourPlates.length === 0 ? (
            <div className="mb-rrow mb-rrow-empty">Nothing saved yet.</div>
          ) : (
            yourPlates.map((r) => (
              <div key={r.key} className="mb-rrow">
                <span className="mb-rrow-label">{r.label}</span>
                <span className={`mb-rrow-state tone-${r.tone}`}>{r.state}</span>
              </div>
            ))
          )}
        </div>
        {recurringRow}
        <div className="mb-rail-flags">
          Allergies flagged on every plate:{' '}
          <span className="mb-rail-flags-list">{dietarySummary ?? 'none'}</span>{' '}
          {!readOnly && (
            <button type="button" className="mb-link" onClick={() => setSheet({ kind: 'flags' })}>
              Edit
            </button>
          )}
        </div>
      </aside>

      {sheet?.kind === 'request' && (
        <RequestSheet
          day={sheet.day}
          m={sheet.meal}
          dietary={dietary}
          pending={pending}
          onClose={() => setSheet(null)}
          onSave={async (note, flags, other) => {
            const ok = await save({ day: sheet.day, meal: sheet.meal.meal }, note, flags, other);
            if (ok) setSheet(null);
          }}
        />
      )}

      {sheet?.kind === 'flags' && (
        <FlagsSheet
          dietary={dietary}
          pending={pending}
          onClose={() => setSheet(null)}
          onSave={(flags, other) => {
            startTransition(async () => {
              const res = await updateMyDietary(flags, other);
              if (!res.ok) {
                show({ text: res.message, tone: 'bad' });
                return;
              }
              setSheet(null);
              router.refresh();
              show({ text: 'Allergies updated for future plates', tone: 'ok' });
            });
          }}
        />
      )}

      {sheet?.kind === 'recurring' && (
        <Dialog title="Recurring plates" eyebrow="Set and forget" onClose={() => setSheet(null)} wide>
          <RecurringSchedules schedules={recurring} disabled={!enabled} />
        </Dialog>
      )}

      {toast && (
        <div key={toast.key} className={`mb-toast tone-${toast.tone}`} role="status">
          {toast.tone === 'ok' && <span className="mb-toast-icon">{I.check}</span>}
          <span className="mb-toast-text">{toast.text}</span>
          {toast.undo && (
            <button type="button" className="mb-link" onClick={toast.undo} disabled={pending}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One meal                                                            */
/* ------------------------------------------------------------------ */

function MealCard({
  day,
  m,
  elapsed,
  enabled,
  readOnly,
  pending,
  onSave,
  onCancel,
}: {
  day: BoardDay;
  m: BoardMeal;
  elapsed: number;
  enabled: boolean;
  readOnly: boolean;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const r = m.request;
  const left = m.minutesLeft === null ? null : m.minutesLeft - elapsed;
  const open = m.open && (left === null || left > 0);
  const actionable = open && !isActive(r);

  return (
    <div className={`mb-meal${actionable && enabled ? ' is-actionable' : ''}`}>
      <div className="mb-meal-head">
        <span className="mb-meal-name">{titleCase(m.meal)}</span>
        <span className="mb-meal-time">{m.serves}</span>
      </div>

      <div className="mb-dishes">
        {m.items.length > 0 ? (
          m.items.map((it, i) => (
            <span key={i} className="mb-dish">{it}</span>
          ))
        ) : (
          <span className="mb-dish is-empty">Menu not posted yet</span>
        )}
        {m.menuStale && m.items.length > 0 && (
          <span className="mb-dish-note">Last known menu</span>
        )}
      </div>

      {r?.status === 'ready' && (
        <div className="mb-status tone-sage">
          <span className="mb-status-icon">{I.check}</span>
          <div className="mb-status-body">
            <span className="mb-status-title">
              {day.isPast ? 'Your plate was boxed' : 'Your plate is in the fridge'}
            </span>
            {r.resolvedAt && <span className="mb-status-sub">Boxed {r.resolvedAt}</span>}
          </div>
        </div>
      )}

      {r?.status === 'waiting' && (
        <div className="mb-status tone-blue">
          <span className="mb-status-dot" />
          <div className="mb-status-body">
            <span className="mb-status-title">Plate saved</span>
            <span className="mb-status-sub">
              Asked {r.askedAt}
              {r.flagLines.length > 0 &&
                ` · ${flaggedLabel(r.hasAllergen, r.hasDietary)}: ${r.flagLines.join(', ')}`}
            </span>
            {r.note && <span className="mb-status-sub">Note: “{r.note}”</span>}
          </div>
          {!readOnly && (
            <button type="button" className="mb-status-cancel" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
          )}
        </div>
      )}

      {r?.status === 'declined' && (
        <div className="mb-status tone-clay">
          <div className="mb-status-body">
            <span className="mb-status-title">The kitchen couldn&apos;t do this one</span>
            <span className="mb-status-sub">{r.reason ?? 'Declined'}</span>
          </div>
        </div>
      )}

      {actionable ? (
        <>
          <button
            type="button"
            className="mb-act"
            onClick={onSave}
            disabled={!enabled || pending}
          >
            {I.plus}
            {enabled || readOnly ? 'Save me a plate' : 'Requests paused'}
          </button>
          <div className="mb-closes">
            {I.clock}
            <span>
              Closes at {m.cutoffLabel}
              {left !== null && left <= 180 && ` · ${leftLabel(left)}`}
            </span>
          </div>
          {r?.status === 'cancelled' && r.resolvedAt && (
            <span className="mb-cancelled">Cancelled {r.resolvedAt}</span>
          )}
        </>
      ) : (
        !isActive(r) &&
        r?.status !== 'declined' && (
          <div className="mb-closed">
            {m.open ? `Requests closed at ${m.cutoffLabel}.` : m.closedReason}
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog: bottom sheet on a phone, centred modal on a desk            */
/* ------------------------------------------------------------------ */

function Dialog({
  eyebrow,
  title,
  sub,
  onClose,
  children,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mb-scrim" onClick={onClose}>
      <div
        className={`mb-sheet${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-grip" aria-hidden="true" />
        <div className="mb-sheet-head">
          <div className="mb-sheet-titles">
            <span className="mb-eyebrow">{eyebrow}</span>
            <h2 className="mb-sheet-title">{title}</h2>
            {sub && <span className="mb-sheet-sub">{sub}</span>}
          </div>
          <button type="button" className="mb-x" onClick={onClose} aria-label="Close">
            {I.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FlagPicker({
  flags,
  other,
  setFlags,
  setOther,
}: {
  flags: string[];
  other: string;
  setFlags: (f: string[]) => void;
  setOther: (s: string) => void;
}) {
  const toggle = (id: string) =>
    setFlags(flags.includes(id) ? flags.filter((f) => f !== id) : [...flags, id]);

  return (
    <div className="mb-picker">
      <div className="mb-picker-title">Allergies</div>
      <div className="mb-picker-grid">
        {ALLERGENS.map((f) => (
          <label key={f.id} className={`mb-check${flags.includes(f.id) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={flags.includes(f.id)} onChange={() => toggle(f.id)} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      <div className="mb-picker-title">Dietary and religious</div>
      <div className="mb-picker-grid">
        {DIETARY.map((f) => (
          <label key={f.id} className={`mb-check${flags.includes(f.id) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={flags.includes(f.id)} onChange={() => toggle(f.id)} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      {flags.includes(OTHER_FLAG_ID) && (
        <input
          className="mb-input"
          placeholder="What should the chefs know?"
          value={other}
          maxLength={140}
          onChange={(e) => setOther(e.target.value)}
        />
      )}
      <div className="mb-picker-foot">Saved as yours, so they are ticked next time.</div>
    </div>
  );
}

function RequestSheet({
  day,
  m,
  dietary,
  pending,
  onClose,
  onSave,
}: {
  day: BoardDay;
  m: BoardMeal;
  dietary: Dietary;
  pending: boolean;
  onClose: () => void;
  onSave: (note: string, flags: string[], other: string) => void;
}) {
  const [note, setNote] = useState('');
  const [flags, setFlags] = useState<string[]>(dietary.flags);
  const [other, setOther] = useState(dietary.other);
  const [editing, setEditing] = useState(false);
  const summary = summariseFlags(flags, other);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pending) onSave(note, flags, other);
  };

  return (
    <Dialog
      eyebrow="Save a plate"
      title={`${titleCase(m.meal)} · ${day.weekday} ${day.dayOfMonth}`}
      sub={m.items.length > 0 ? m.items.join(', ') : undefined}
      onClose={onClose}
    >
      <form className="mb-form" onSubmit={submit}>
        <div className="mb-flagbox">
          <div className="mb-flagbox-head">
            <span className="mb-flagbox-label">Allergies flagged for the kitchen</span>
            <button type="button" className="mb-flagbox-edit" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done' : summary.hasAny ? 'Edit' : 'Add'}
            </button>
          </div>
          <span className="mb-flagbox-list">
            {summary.hasAny ? summary.lines.join(' · ') : 'None on file'}
          </span>
          {editing && (
            <FlagPicker flags={flags} other={other} setFlags={setFlags} setOther={setOther} />
          )}
        </div>

        <label className="mb-field">
          <span className="mb-field-label">
            Note for the kitchen <span className="mb-field-opt">· optional</span>
          </span>
          <input
            className="mb-input"
            placeholder="e.g. no gravy, back around 9"
            value={note}
            maxLength={140}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="mb-form-actions">
          <button type="button" className="mb-act is-ghost mb-only-wide" onClick={onClose}>
            Not now
          </button>
          <button type="submit" className="mb-act is-big" disabled={pending}>
            {pending ? 'Saving…' : 'Save my plate'}
            <span className="mb-kbd mb-only-wide" aria-hidden="true">↵</span>
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function FlagsSheet({
  dietary,
  pending,
  onClose,
  onSave,
}: {
  dietary: Dietary;
  pending: boolean;
  onClose: () => void;
  onSave: (flags: string[], other: string) => void;
}) {
  const [flags, setFlags] = useState<string[]>(dietary.flags);
  const [other, setOther] = useState(dietary.other);

  return (
    <Dialog eyebrow="Your allergies" title="Flagged on every plate" onClose={onClose}>
      <form
        className="mb-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(flags, other);
        }}
      >
        <FlagPicker flags={flags} other={other} setFlags={setFlags} setOther={setOther} />
        <div className="mb-form-actions">
          <button type="button" className="mb-act is-ghost" onClick={onClose}>
            Not now
          </button>
          <button type="submit" className="mb-act is-big" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
