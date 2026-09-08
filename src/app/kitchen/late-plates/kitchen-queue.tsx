'use client';

import { useCallback, useEffect, useState } from 'react';

import { RememberToken } from './token-recovery.tsx';
import { MenuEditor } from './menu-editor.tsx';

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
 * Polls the same public API the TV will use rather than going through a server
 * action: the chefs have no session, the device token in the URL is their
 * identity, and the endpoints already enforce it.
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
 * One tap each. Still placeholders until Chris gives his own words - these are
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
  device,
  date,
  prettyDate,
  initialMeal,
}: {
  device: string;
  date: string;
  prettyDate: string;
  initialMeal: MealName;
}) {
  const [view, setView] = useState<KioskView>('plates');
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meal, setMeal] = useState<MealName>(initialMeal);
  const [confirming, setConfirming] = useState<Plate | null>(null);
  const [declining, setDeclining] = useState<Plate | null>(null);
  const [declineText, setDeclineText] = useState('');
  const [showHandled, setShowHandled] = useState(false);
  const [editingCutoff, setEditingCutoff] = useState<MealName | null>(null);
  const [draftMinutes, setDraftMinutes] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [mountedAt] = useState(() => Date.now());

  const STALE_THRESHOLD_MS = 120_000; // 2 minutes

  const load = useCallback(async () => {
    try {
      // all=1 so cancelled and declined plates are visible here. A brother who
      // cancelled silently vanishing from this screen is exactly the bug the
      // chefs would never report and never trust the tool again after.
      const res = await fetch(
        `/api/late-plates?date=${date}&all=1&device=${encodeURIComponent(device)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      setData((await res.json()) as Payload);
      setError(null);
      setLastUpdated(Date.now());
      setIsDisconnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server');
    }
  }, [date, device]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const checkInterval = setInterval(() => {
      const referenceTime = lastUpdated ?? mountedAt;
      if (Date.now() - referenceTime > STALE_THRESHOLD_MS) {
        setIsDisconnected(true);
      }
    }, 1_000);
    return () => clearInterval(checkInterval);
  }, [lastUpdated, mountedAt]);

  async function patch(
    plate: Plate,
    body: { status: string; reason?: string; acknowledged?: boolean },
  ) {
    setBusy(plate.id);
    try {
      const res = await fetch(
        `/api/late-plates/${plate.id}?device=${encodeURIComponent(device)}`,
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
        `/api/late-plates/settings?device=${encodeURIComponent(device)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, [m]: change }),
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
  const counts = data?.meals?.[meal];

  const totalToMake =
    (data?.meals?.lunch?.toMake ?? 0) + (data?.meals?.dinner?.toMake ?? 0);

  return (
    <>
      <RememberToken device={device} />

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
                <strong>NO NETWORK CONNECTION</strong> — Not updated in over 2 minutes
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
              onClick={() => setView('plates')}
            >
              <span className="kq-view-icon">📋</span>
              <span>Late Plates</span>
              {totalToMake > 0 && (
                <span className="kq-view-badge pending">{totalToMake} to make</span>
              )}
            </button>
            <button
              role="tab"
              aria-selected={view === 'menus'}
              className={`kq-view-btn${view === 'menus' ? ' active' : ''}`}
              onClick={() => setView('menus')}
            >
              <span className="kq-view-icon">🍽️</span>
              <span>Menu</span>
            </button>
          </div>
        </div>

        <div className="kq-head-right">
          {view === 'plates' && (
            <div className="kq-switch" role="tablist" aria-label="Meal">
              {MEALS.map((m) => {
                const outstanding = data?.meals?.[m]?.toMake ?? 0;
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={meal === m}
                    className={`kq-switch-btn${meal === m ? ' active' : ''}`}
                    onClick={() => {
                      setMeal(m);
                      setShowHandled(false);
                    }}
                  >
                    <span className="kq-switch-label">{m}</span>
                    <span
                      className={`kq-switch-count${outstanding > 0 ? ' pending' : ''}`}
                    >
                      {outstanding > 0 ? `${outstanding} to make` : 'all done'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {view === 'menus' ? (
        <MenuEditor device={device} todayIso={date} />
      ) : (
        <>
          {error && <div className="kq-error">{error}</div>}

          {data === null && !error && <div className="kq-empty">Loading…</div>}

      {counts && (
        <div className="kq-mealbar">
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
                  <PlateHead plate={plate} />
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
            Handled
            <span className="kq-section-count">{handled.length}</span>
            <span className="kq-section-chevron">{showHandled ? '▾' : '▸'}</span>
          </button>

          {showHandled && (
            <div className="kq-list is-handled">
              {handled.map((plate) => (
                <article
                  key={plate.id}
                  className={`kq-card small is-${plate.status}`}
                >
                  <div className="kq-card-main">
                    <PlateHead plate={plate} />

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
      )}
    </>
  );
}

function PlateHead({ plate }: { plate: Plate }) {
  return (
    <div className="kq-head-row">
      <span className="kq-name">{plate.name}</span>
      <span className="kq-asked">asked {clockOf(plate.requestedAt)}</span>
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
