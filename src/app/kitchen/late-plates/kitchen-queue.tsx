'use client';

import { useCallback, useEffect, useState } from 'react';

import { todayInEastern, parseISO, houseClockMinutes } from '../../../lib/dates.ts';
import { MenuEditor, hasUnsavedMenu } from './menu-editor.tsx';

type KioskView = 'plates' | 'menus';

/**
 * The live queue and kitchen console, as the kitchen sees it.
 *
 * Three rules shape the layout, all of them from how the kitchen actually runs:
 *
 *  1. **One meal at a time.** Only lunch or dinner is ever out and being served,
 *     so the screen shows one meal and opens on whichever is current. The other
 *     is one tap away with its outstanding count always visible, so nothing can
 *     hide behind the toggle.
 *
 *  2. **Unaddressed plates are the screen.** What is still to make sits at the
 *     top at full size, in the order it was asked for. What has been dealt with
 *     drops to a quieter section below — present, because a chef needs to check
 *     lunch is finished before starting dinner, but never competing for
 *     attention with work that is still outstanding.
 *
 *  3. **A cancelled plate is not actionable.** It shows with the time it was
 *     cancelled and no buttons at all. The server refuses these too — this is the
 *     screen agreeing with the rule, not enforcing it.
 *
 * Polls the JSON API rather than going through server actions. The tablet is
 * authenticated by its pairing cookie (or the manager by his session), which
 * the browser sends with every same-origin request, and the endpoints enforce
 * who may do what.
 */

type Status = 'waiting' | 'ready' | 'declined' | 'cancelled';
type MealName = 'lunch' | 'dinner';

interface Plate {
  id: string;
  name: string;
  meal: MealName;
  status: Status;
  note: string | null;
  reason: string | null;
  allergens: string[];
  dietary: string[];
  restrictions: string[];
  hasAllergen: boolean;
  needsAcknowledgement: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  requestedAt: string;
  cancelledAt: string | null;
  resolvedAt: string | null;
}

interface MealCounts {
  toMake: number;
  ready: number;
  declined: number;
  cancelled: number;
  handled: number;
  /** Display form, e.g. "1:30 PM". */
  cutoff: string;
  /** "HH:MM" - what the stepper edits. */
  cutoff24: string;
  standingCutoff: string;
  standingCutoff24: string;
  closed: boolean;
  served: boolean;
  open: boolean;
  closedReason: string | null;
}

interface Payload {
  success: boolean;
  date: string;
  dayOfWeek: string;
  currentMeal: MealName;
  latePlates: Plate[];
  meals: Record<MealName, MealCounts>;
}

const MEALS: MealName[] = ['lunch', 'dinner'];

/**
 * One tap each. Still placeholders until the chefs give their own words - these are
 * the mockup's, which are at least plausible rather than invented on the spot.
 */
const DECLINE_REASONS = [
  'Kitchen closed for the night',
  'Ran out of food',
  'Missed the cutoff time',
];

/** How far one tap of the stepper moves a cutoff. */
const STEP_MINUTES = 15;

function parseHHMM(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatHHMM(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(
    wrapped % 60,
  ).padStart(2, '0')}`;
}

function prettyMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(wrapped % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "2026-09-18" on the house clock, from an ISO string. */
function houseDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * When a plate was asked for, in terms a chef can act on.
 *
 * A request for tonight may have been placed days ago - recurring plates and
 * people asking ahead both do it - and a bare "4:42 PM" on one of those says
 * nothing useful and quietly implies it came in today. So same-day requests
 * keep the clock time, and anything older says how long ago instead, without
 * naming a date nobody needs.
 */
function askedLabel(requestedAt: string, mealDate: string): string {
  const asked = houseDateOf(requestedAt);
  if (asked === mealDate) return `asked ${clockOf(requestedAt)}`;

  const days = Math.round(
    (Date.parse(`${mealDate}T12:00:00Z`) - Date.parse(`${asked}T12:00:00Z`)) /
      86_400_000,
  );
  if (days === 1) return 'asked yesterday';
  if (days > 1) return `asked ${days} days ago`;
  return `asked ${clockOf(requestedAt)}`;
}

/** "4:42 PM" on the house clock, from an ISO string. */
function clockOf(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function byRequestedAt(a: Plate, b: Plate): number {
  return Date.parse(a.requestedAt) - Date.parse(b.requestedAt);
}

export function KitchenQueue({
  initialDate,
  isExplicitDate = false,
  initialMeal,
}: {
  initialDate: string;
  isExplicitDate?: boolean;
  initialMeal: MealName;
}) {
  const [activeDate, setActiveDate] = useState<string>(initialDate);
  const [view, setView] = useState<KioskView>('plates');
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meal, setMeal] = useState<MealName>(initialMeal);
  const [confirming, setConfirming] = useState<Plate | null>(null);
  const [declining, setDeclining] = useState<Plate | null>(null);
  const [declineText, setDeclineText] = useState('');
  const [showHandled, setShowHandled] = useState(false);
  const [handledView, setHandledView] = useState<Status | 'all'>('all');
  const [dismissedCancels, setDismissedCancels] = useState<string[]>([]);
  const [editingCutoff, setEditingCutoff] = useState<MealName | null>(null);
  const [draftMinutes, setDraftMinutes] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  // Drives the cutoff countdown. Minute granularity: this hangs on a kitchen
  // wall all day and a ticking seconds readout is just noise from two feet
  // away, where the only question is "have we got time or not".
  const [nowMinutes, setNowMinutes] = useState(() => houseClockMinutes());

  const STALE_THRESHOLD_MS = 120_000; // 2 minutes

  const prettyDate = parseISO(activeDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const load = useCallback(async () => {
    try {
      // In live kiosk mode (isExplicitDate is false), always query without date
      // so the server resolves the canonical current day in Eastern Time.
      const url = isExplicitDate
        ? `/api/late-plates?date=${activeDate}&all=1`
        : '/api/late-plates?all=1';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const payload = (await res.json()) as Payload;

      if (!isExplicitDate && payload.date && payload.date !== activeDate) {
        // Day boundary crossed! Update active date and current meal.
        setActiveDate(payload.date);
        if (payload.currentMeal) {
          setMeal(payload.currentMeal);
        }
      }

      setData(payload);
      setError(null);
      setLastUpdated(Date.now());
      setIsDisconnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server');
    }
  }, [activeDate, isExplicitDate]);

  // 1. Regular polling loop
  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  // 2. Hardware / Browser Wake & Reconnection Handlers
  useEffect(() => {
    const onWakeOrOnline = () => {
      if (document.visibilityState === 'visible') {
        if (!isExplicitDate) {
          const liveDate = todayInEastern();
          if (liveDate !== activeDate) {
            setActiveDate(liveDate);
          }
        }
        load();
      }
    };
    const onFocus = () => {
      load();
    };
    const onOnline = () => {
      setIsDisconnected(false);
      load();
    };

    document.addEventListener('visibilitychange', onWakeOrOnline);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onWakeOrOnline);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [activeDate, isExplicitDate, load]);

  // 3. Midnight Rollover & Off-Hours Maintenance Watchdog (4:00 AM Eastern)
  useEffect(() => {
    const watchdogTimer = setInterval(() => {
      if (!isExplicitDate) {
        const liveDate = todayInEastern();
        if (liveDate !== activeDate) {
          setActiveDate(liveDate);
          load();
        }
      }

      // Scheduled 4:00 AM off-hours automatic reload for 24/7 kiosk health
      // (ensures clean DOM, refreshed JS heap, updated Next.js build chunks)
      const minutesOfDay = houseClockMinutes();
      const isOffHours = minutesOfDay >= 240 && minutesOfDay < 245; // 4:00 AM - 4:05 AM
      const uptimeHours = (Date.now() - mountedAt) / 3_600_000;

      if (isOffHours && uptimeHours > 2) {
        // Never reload out from under a chef: not while a modal is open, and
        // not while a menu is part-typed either - the autosave lands 1.5s after
        // the last keystroke, so this only ever waits moments.
        if (!confirming && !declining && !editingCutoff && !hasUnsavedMenu()) {
          window.location.reload();
        }
      }
    }, 15_000);

    return () => clearInterval(watchdogTimer);
  }, [activeDate, confirming, declining, editingCutoff, isExplicitDate, load, mountedAt]);

  // 3b. Cutoff countdown tick
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(houseClockMinutes()), 10_000);
    return () => clearInterval(t);
  }, []);

  // 4. Stale Connection & Recovery Watchdog
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const referenceTime = lastUpdated ?? mountedAt;
      const staleDuration = Date.now() - referenceTime;
      if (staleDuration > STALE_THRESHOLD_MS) {
        setIsDisconnected(true);
      }
      // If disconnected for > 15 minutes, recover by reloading once online and idle
      if (staleDuration > 15 * 60 * 1000 && navigator.onLine) {
        if (!confirming && !declining && !editingCutoff && !hasUnsavedMenu()) {
          window.location.reload();
        }
      }
    }, 1_000);
    return () => clearInterval(checkInterval);
  }, [confirming, declining, editingCutoff, lastUpdated, mountedAt]);

  async function patch(
    plate: Plate,
    body: { status: string; reason?: string; acknowledged?: boolean },
  ) {
    setBusy(plate.id);
    try {
      const res = await fetch(
        `/api/late-plates/${plate.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { ok?: boolean; message?: string };
      setError(!res.ok || json.ok === false ? (json.message ?? `Server said ${res.status}`) : null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server');
    } finally {
      setBusy(null);
      setConfirming(null);
      setDeclining(null);
      setDeclineText('');
    }
  }

  /**
   * Writes a meal setting through the same gated endpoint everything else uses.
   *
   * Optimism is deliberately avoided here: the toggle and the cutoff both
   * change what brothers can do, so the screen shows what the server actually
   * accepted rather than what was tapped.
   */
  async function saveSettings(
    m: MealName,
    change: { cutoff?: string; closed?: boolean },
  ) {
    setSavingSettings(true);
    try {
      const res = await fetch(
        '/api/late-plates/settings',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: activeDate, [m]: change }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; message?: string };
      setError(!res.ok || json.ok === false ? (json.message ?? `Server said ${res.status}`) : null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server');
    } finally {
      setSavingSettings(false);
      setEditingCutoff(null);
    }
  }

  function openCutoffEditor(m: MealName) {
    setDraftMinutes(parseHHMM(data?.meals?.[m]?.cutoff24 ?? '16:00'));
    setEditingCutoff(m);
  }

  function markReady(plate: Plate) {
    if (plate.restrictions.length > 0) {
      setConfirming(plate);
      return;
    }
    patch(plate, { status: 'ready' });
  }

  const forMeal = (data?.latePlates ?? []).filter((p) => p.meal === meal);
  const toMake = forMeal.filter((p) => p.status === 'waiting').sort(byRequestedAt);
  const handled = forMeal.filter((p) => p.status !== 'waiting').sort(byRequestedAt);

  // A cancellation that lands after cooking has started is a wasted plate, and
  // it used to sit inside a collapsed section where nobody would see it. It
  // comes out in front until a chef says he has seen it.
  const freshCancels = forMeal.filter(
    (p) => p.status === 'cancelled' && !dismissedCancels.includes(p.id),
  );

  const handledCounts = {
    ready: handled.filter((p) => p.status === 'ready').length,
    declined: handled.filter((p) => p.status === 'declined').length,
    cancelled: handled.filter((p) => p.status === 'cancelled').length,
  };
  const handledShown =
    handledView === 'all' ? handled : handled.filter((p) => p.status === handledView);
  const counts = data?.meals?.[meal];

  const totalToMake =
    (data?.meals?.lunch?.toMake ?? 0) + (data?.meals?.dinner?.toMake ?? 0);

  return (
    <>

      <header className="kq-head">
        <div className="kq-head-left">
          <div className="kq-head-brand">
            <h1>Kitchen Kiosk</h1>
            <div className="kq-date">{prettyDate}</div>
          </div>

          {isDisconnected && (
            <div className="kq-offline-banner" role="alert">
              <span className="kq-offline-dot" aria-hidden="true" />
              <span>
                Showing what we had at{' '}
              <strong>
                {lastUpdated
                  ? new Date(lastUpdated).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'start-up'}
              </strong>{' '}
              — trying to reconnect
              </span>
            </div>
          )}
        </div>

        <div className="kq-head-center">
          <div className="kq-view-nav" role="tablist" aria-label="Kiosk View">
            <button
              role="tab"
              aria-selected={view === 'plates'}
              className={`kq-view-btn${view === 'plates' ? ' active' : ''}`}
              onClick={() => {
                if (!isExplicitDate) {
                  const liveDate = todayInEastern();
                  if (liveDate !== activeDate) {
                    setActiveDate(liveDate);
                  }
                }
                setView('plates');
              }}
            >
              <span className="kq-view-icon">🍽️</span>
              <span>Late Plates</span>
              {totalToMake > 0 && (
                <span className="kq-view-badge pending">{totalToMake} to make</span>
              )}
            </button>
            <button
              role="tab"
              aria-selected={view === 'menus'}
              className={`kq-view-btn${view === 'menus' ? ' active' : ''}`}
              onClick={() => {
                if (!isExplicitDate) {
                  const liveDate = todayInEastern();
                  if (liveDate !== activeDate) {
                    setActiveDate(liveDate);
                  }
                }
                setView('menus');
              }}
            >
              <span className="kq-view-icon">📋</span>
              <span>Menu</span>
            </button>
          </div>
        </div>

        <div className="kq-head-right">
          {view === 'plates' && (
            <div className="kq-switch" role="tablist" aria-label="Meal">
              {MEALS.map((m) => {
                const outstanding = data?.meals?.[m]?.toMake ?? 0;
                // "All done" only once there was something to do. A meal
                // nobody has asked for yet says so, rather than looking finished.
                const handledCount = data?.meals?.[m]?.handled ?? 0;
                const status =
                  outstanding > 0 ? `${outstanding} to make` : handledCount > 0 ? 'all done' : 'none yet';
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={meal === m}
                    className={`kq-switch-btn is-${m}${meal === m ? ' active' : ''}`}
                    onClick={() => {
                      setMeal(m);
                      setShowHandled(false);
                    }}
                  >
                    <span className="kq-switch-label">{m}</span>
                    <span
                      className={`kq-switch-count${outstanding > 0 ? ' pending' : ''}`}
                    >
                      {status}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {view === 'menus' ? (
        <MenuEditor todayIso={activeDate} />
      ) : (
        <div className="kq-queue-view">
          {error && <div className="kq-error">{error}</div>}

          {data === null && !error && <div className="kq-empty">Loading…</div>}

      {freshCancels.length > 0 && (
        <div className="kq-cancel-alert" role="alert">
          <span className="kq-cancel-mark" aria-hidden="true">
            ✕
          </span>
          <div className="kq-cancel-text">
            <span className="kq-cancel-title">
              {freshCancels.map((p) => p.name).join(', ')}{' '}
              {freshCancels.length === 1 ? 'cancelled' : 'cancelled'} — do not
              make {freshCancels.length === 1 ? 'this plate' : 'these plates'}
            </span>
            <span className="kq-cancel-sub">
              {freshCancels.length === 1 && freshCancels[0].cancelledAt
                ? `Cancelled at ${clockOf(freshCancels[0].cancelledAt)}, after asking.`
                : 'Cancelled after asking.'}{' '}
              If you have already boxed {freshCancels.length === 1 ? 'it' : 'them'}, {freshCancels.length === 1 ? 'it is' : 'they are'} spare.
            </span>
          </div>
          <button
            className="kq-btn ghost"
            onClick={() => setDismissedCancels((v) => [...v, ...freshCancels.map((p) => p.id)])}
          >
            Got it
          </button>
        </div>
      )}

      {counts && (
        <CutoffCountdown
          meal={meal}
          cutoff={counts.cutoff}
          cutoff24={counts.cutoff24}
          nowMinutes={nowMinutes}
          closed={counts.closed}
          served={counts.served}
        />
      )}

      {counts && (
        <div className={`kq-mealbar is-${meal}`}>
          <div className="kq-mealbar-row">
            <span className="kq-mealbar-title">{meal}</span>
            <label className="kq-toggle">
              <input
                type="checkbox"
                checked={!counts.closed}
                disabled={savingSettings || !counts.served}
                onChange={(e) => saveSettings(meal, { closed: !e.target.checked })}
              />
              <span className="kq-toggle-track" aria-hidden="true">
                <span className="kq-toggle-knob" />
              </span>
              <span className="kq-toggle-label">
                {counts.served
                  ? counts.closed
                    ? 'Not taking requests'
                    : 'Taking requests'
                  : 'Not served today'}
              </span>
            </label>
          </div>

          <button
            className="kq-cutoff"
            onClick={() => openCutoffEditor(meal)}
            disabled={savingSettings}
          >
            <span className="kq-cutoff-label">Cutoff time</span>
            <span className="kq-cutoff-value">{counts.cutoff}</span>
          </button>

          {counts.closed && (
            <div className="kq-mealbar-note">
              Brothers cannot ask for a {meal} plate today. The cutoff comes back
              tomorrow on its own.
            </div>
          )}
        </div>
      )}

      {data !== null && toMake.length === 0 && (
        <div className="kq-clear">
          <div className="kq-clear-mark" aria-hidden="true">
            ✓
          </div>
          <div className="kq-clear-title">
            {handled.length === 0
              ? `No ${meal} late plates today.`
              : `All ${meal} late plates are done.`}
          </div>
          <div className="kq-clear-sub">
            {handled.length === 0
              ? 'Nobody has asked for one. Nothing to set aside.'
              : `${handled.length} handled — they're listed below.`}
          </div>
        </div>
      )}

      {toMake.length > 0 && (
        <>
          <div className="kq-section">
            Still to make
            <span className="kq-section-count">{toMake.length}</span>
          </div>
          <div className="kq-list">
            {toMake.map((plate) => (
              <article
                key={plate.id}
                className={`kq-card${plate.hasAllergen ? ' has-allergen' : ''}`}
              >
                <div className="kq-card-main">
                  <PlateHead plate={plate} mealDate={activeDate} />
                  <Restrictions plate={plate} />
                  {plate.note && <div className="kq-note">“{plate.note}”</div>}
                </div>

                <div className="kq-card-actions">
                  <button
                    className="kq-btn ready"
                    disabled={busy === plate.id}
                    onClick={() => markReady(plate)}
                  >
                    Ready
                  </button>
                  <button
                    className="kq-btn decline"
                    disabled={busy === plate.id}
                    onClick={() => setDeclining(plate)}
                  >
                    Can&apos;t do it
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {handled.length > 0 && (
        <>
          <button
            className="kq-section as-toggle"
            onClick={() => setShowHandled((v) => !v)}
            aria-expanded={showHandled}
          >
            Already handled
            <span className="kq-section-count">{handled.length}</span>
            <span className="kq-section-chevron">{showHandled ? '▾' : '▸'}</span>
          </button>

          {showHandled && (
            <div className="kq-handled-filter" role="tablist" aria-label="Which outcome">
              {([
                ['all', 'All', handled.length],
                ['ready', 'Ready', handledCounts.ready],
                ['declined', 'Declined', handledCounts.declined],
                ['cancelled', 'Cancelled', handledCounts.cancelled],
              ] as const).map(([key, label, n]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={handledView === key}
                  className={`kq-handled-tab is-${key}${handledView === key ? ' active' : ''}`}
                  onClick={() => setHandledView(key as Status | 'all')}
                  disabled={n === 0 && key !== 'all'}
                >
                  {label} <span className="kq-handled-n">{n}</span>
                </button>
              ))}
            </div>
          )}

          {showHandled && (
            <div className="kq-list is-handled">
              {handledShown.map((plate) => (
                <article
                  key={plate.id}
                  className={`kq-card small is-${plate.status}`}
                >
                  <div className="kq-card-main">
                    <PlateHead plate={plate} mealDate={activeDate} />

                    {plate.status === 'cancelled' ? (
                      <div className="kq-cancelled">
                        Cancelled by {plate.name.split(' ')[0]} at{' '}
                        {clockOf(plate.cancelledAt)} — do not make this
                      </div>
                    ) : plate.status === 'declined' ? (
                      <div className="kq-declined">
                        Declined{plate.reason ? `: ${plate.reason}` : ''}
                      </div>
                    ) : (
                      <div className="kq-readyline">
                        Ready at {clockOf(plate.resolvedAt)}
                        {plate.acknowledgedBy
                          ? ` · restrictions acknowledged by ${plate.acknowledgedBy}`
                          : ''}
                      </div>
                    )}

                    {plate.status !== 'cancelled' && <Restrictions plate={plate} />}
                  </div>

                  <div className="kq-card-actions">
                    {plate.status === 'cancelled' ? (
                      // No buttons at all. The server refuses these too.
                      <span className="kq-locked-note">Cancelled</span>
                    ) : (
                      <button
                        className="kq-btn undo"
                        disabled={busy === plate.id}
                        onClick={() => patch(plate, { status: 'waiting' })}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {counts?.closedReason && !counts.closed && toMake.length === 0 && (
        <div className="kq-foot">{counts.closedReason}</div>
      )}
    </div>
  )}

      {confirming && (
        <div className="kq-modal-scrim" role="dialog" aria-modal="true">
          <div className="kq-modal">
            <h2>{confirming.name}&apos;s plate</h2>
            <p className="kq-modal-lead">
              Before this goes out, read what he cannot eat:
            </p>

            {confirming.allergens.length > 0 && (
              <div className="kq-modal-block allergen">
                <div className="kq-modal-label">Allergies</div>
                <ul>
                  {confirming.allergens.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {confirming.dietary.length > 0 && (
              <div className="kq-modal-block dietary">
                <div className="kq-modal-label">Dietary and religious</div>
                <ul>
                  {confirming.dietary.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="kq-modal-actions">
              <button className="kq-btn ghost" onClick={() => setConfirming(null)}>
                Go back
              </button>
              <button
                className="kq-btn ready"
                disabled={busy === confirming.id}
                onClick={() =>
                  patch(confirming, { status: 'ready', acknowledged: true })
                }
              >
                I&apos;ve read this — mark ready
              </button>
            </div>
          </div>
        </div>
      )}

      {declining && (
        <div className="kq-modal-scrim" role="dialog" aria-modal="true">
          <div className="kq-modal">
            <h2>Decline {declining.name}&apos;s request?</h2>
            <p className="kq-modal-lead">
              Pick a reason — {declining.name.split(' ')[0]} will see it.
            </p>

            {/* One tap declines. A reason then a confirm is two taps for a
                decision already made, and greasy-fingered chefs will not
                thank you for the second one. */}
            <div className="kq-reason-list">
              {DECLINE_REASONS.map((r) => (
                <button
                  key={r}
                  className="kq-reason-row"
                  disabled={busy === declining.id}
                  onClick={() => patch(declining, { status: 'declined', reason: r })}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="kq-reason-other">
              <input
                className="kq-reason-field"
                placeholder="Another reason…"
                value={declineText}
                maxLength={140}
                onChange={(e) => setDeclineText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && declineText.trim()) {
                    patch(declining, { status: 'declined', reason: declineText });
                  }
                }}
              />
              <button
                className="kq-btn decline"
                disabled={busy === declining.id || !declineText.trim()}
                onClick={() =>
                  patch(declining, { status: 'declined', reason: declineText })
                }
              >
                Decline
              </button>
            </div>

            <button
              className="kq-nevermind"
              onClick={() => {
                setDeclining(null);
                setDeclineText('');
              }}
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {editingCutoff && (
        <div className="kq-modal-scrim" role="dialog" aria-modal="true">
          <div className="kq-modal kq-modal-cutoff">
            <button
              className="kq-modal-close"
              aria-label="Close"
              onClick={() => setEditingCutoff(null)}
            >
              ×
            </button>

            <div className="kq-modal-eyebrow">{editingCutoff} cutoff</div>
            <h2>Accepting late plates until</h2>

            <div className="kq-stepper">
              <div className="kq-stepper-value" aria-live="polite">
                {prettyMinutes(draftMinutes)}
              </div>
              <div className="kq-stepper-arrows">
                <button
                  aria-label={`Later by ${STEP_MINUTES} minutes`}
                  onClick={() => setDraftMinutes((m) => m + STEP_MINUTES)}
                >
                  ▲
                </button>
                <button
                  aria-label={`Earlier by ${STEP_MINUTES} minutes`}
                  onClick={() => setDraftMinutes((m) => m - STEP_MINUTES)}
                >
                  ▼
                </button>
              </div>
            </div>

            <p className="kq-stepper-hint">
              {STEP_MINUTES} minutes per tap. This becomes the {editingCutoff}{' '}
              cutoff from now on, not just today.
            </p>

            <button
              className="kq-btn save"
              disabled={savingSettings}
              onClick={() =>
                saveSettings(editingCutoff, { cutoff: formatHHMM(draftMinutes) })
              }
            >
              {savingSettings ? 'Saving…' : 'Save cutoff time'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * How long is left before requests close for this meal.
 *
 * The chefs check the kiosk at the cutoff and then make every plate in one go.
 * They have started ten minutes early before now and left out somebody who got
 * his request in just before the deadline, so the screen has to say plainly
 * that the list is not final yet - and, just as importantly, say when it is.
 */
function CutoffCountdown({
  meal,
  cutoff,
  cutoff24,
  nowMinutes,
  closed,
  served,
}: {
  meal: MealName;
  cutoff: string;
  cutoff24: string;
  nowMinutes: number;
  closed: boolean;
  served: boolean;
}) {
  if (!served) return null;

  const cutoffMinutes = parseHHMM(cutoff24);
  const left = cutoffMinutes - nowMinutes;

  if (closed) {
    return (
      <div className={`kq-countdown is-shut is-${meal}`}>
        <span className="kq-countdown-lead">
          {meal === 'lunch' ? 'Lunch is closed for today.' : 'Dinner is shut for the night.'} Nothing more can come in.
        </span>
      </div>
    );
  }

  if (left <= 0) {
    return (
      <div className={`kq-countdown is-closed is-${meal}`}>
        <span className="kq-countdown-title">
          Requests closed at {cutoff}. This is everyone.
        </span>
        <span className="kq-countdown-lead">
          Nothing more can come in for {meal} — safe to start.
        </span>
      </div>
    );
  }

  const hh = Math.floor(left / 60);
  const mm = left % 60;
  const big = hh > 0 ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
  const words =
    left === 1
      ? '1 minute'
      : hh > 0
        ? mm > 0
          ? `${hh}h ${mm}m`
          : `${hh} hour${hh > 1 ? 's' : ''}`
        : `${left} minutes`;

  return (
    <div className={`kq-countdown is-open is-${meal}`}>
      <div className="kq-countdown-text">
        <span className="kq-countdown-title">
          {meal} requests close in {words}
          <span className="kq-countdown-at">{cutoff}</span>
        </span>
        <span className="kq-countdown-lead">
          More can still come in. Wait for this to run out before you start
          plating — the list is not final yet.
        </span>
      </div>
      <span className="kq-countdown-big">{big}</span>
    </div>
  );
}

function PlateHead({ plate, mealDate }: { plate: Plate; mealDate: string }) {
  return (
    <div className="kq-head-row">
      <span className="kq-name">{plate.name}</span>
      <span className="kq-asked">{askedLabel(plate.requestedAt, mealDate)}</span>
    </div>
  );
}

function Restrictions({ plate }: { plate: Plate }) {
  if (plate.restrictions.length === 0) return null;
  return (
    <>
      {plate.allergens.length > 0 && (
        <div className="kq-allergens">
          <span className="kq-badge allergen">Allergy</span>
          {plate.allergens.join(' · ')}
        </div>
      )}
      {plate.dietary.length > 0 && (
        <div className="kq-dietary">
          <span className="kq-badge dietary">Dietary</span>
          {plate.dietary.join(' · ')}
        </div>
      )}
    </>
  );
}
