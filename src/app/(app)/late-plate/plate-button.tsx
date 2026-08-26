'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { requestPlate, cancelPlate } from '../../actions/late-plate-actions.ts';
import {
  ALLERGENS,
  DIETARY,
  OTHER_FLAG_ID,
  summariseFlags,
} from '../../../lib/dietary.ts';
import type { Meal } from '../../../lib/types.ts';

type Props =
  | {
      mode: 'request';
      date: string;
      meal: Meal;
      /** His standing flags, already ticked. */
      defaultFlags: string[];
      defaultOther: string;
      /** Whether late plate requesting is paused by the kitchen manager */
      disabled?: boolean;
      disabledReason?: string;
    }
  | {
      mode: 'cancel';
      id: string;
      /** The kitchen has already made it. Cancelling still helps them. */
      alreadyReady: boolean;
      /** Whether this is a day-of cancellation */
      isDayOf?: boolean;
    };

/**
 * One tap to ask, one tap to cancel.
 *
 * His allergies come pre-ticked from his member record and are shown as a
 * single summary line, not sixteen checkboxes. That keeps the common case at
 * one tap while still putting what the kitchen will be told in front of him
 * every time - a man whose allergy is listed wrong finds out here, not at the
 * serving line.
 *
 * The note and the flag panel are both behind secondary links, because almost
 * nobody changes either and a form in front of the button is what turns a
 * one-second action into a five-second one.
 */
export function PlateButton(props: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [flags, setFlags] = useState<string[]>(
    props.mode === 'request' ? props.defaultFlags : [],
  );
  const [other, setOther] = useState(
    props.mode === 'request' ? props.defaultOther : '',
  );

  const [showCancelModal, setShowCancelModal] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) {
        setNoteOpen(false);
        setNote('');
        setFlagsOpen(false);
        setShowCancelModal(false);
        router.refresh();
      }
    });
  }

  if (props.mode === 'cancel') {
    const handleCancelClick = () => {
      if (props.isDayOf) {
        setShowCancelModal(true);
      } else {
        run(() => cancelPlate(props.id));
      }
    };

    return (
      <div className="lp-actions">
        <button
          className="btn sm danger"
          type="button"
          disabled={pending}
          onClick={handleCancelClick}
        >
          {pending && <span className="spinner" />}
          {pending ? 'Cancelling…' : "Cancel — I'll be there"}
        </button>
        {props.isDayOf && (
          <div className="lp-cancel-warn">
            Note: If you cancel today, you cannot request another plate for this meal today.
          </div>
        )}
        {props.alreadyReady && (
          <div className="lp-msg">
            Already plated. Cancelling still tells the kitchen not to hold it.
          </div>
        )}
        {message && (
          <div
            className="lp-msg"
            style={failed ? { color: 'var(--red-600)' } : { color: 'var(--gold-400)' }}
          >
            {message}
          </div>
        )}

        {/* Day-of Cancellation Warning Popup Modal */}
        {showCancelModal && (
          <div className="claim-confirm-modal-overlay">
            <div className="claim-confirm-modal card card-pad" style={{ maxWidth: 460 }}>
              <div className="confirm-header">
                <span className="warning-icon">⚠️</span>
                <strong style={{ fontSize: 16 }}>Cancel Today&apos;s Late Plate?</strong>
              </div>
              <div className="confirm-body">
                <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.45 }}>
                  If you cancel this late plate, <strong>you will not be able to request another late plate for this same meal today</strong>.
                </p>
                <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 6, lineHeight: 1.4 }}>
                  The chefs prepare late plates based on finalized counts. Are you sure you want to cancel and eat during regular service instead?
                </p>
              </div>
              <div className="confirm-actions" style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  disabled={pending}
                >
                  Keep My Plate
                </button>
                <button
                  className="btn sm danger"
                  type="button"
                  onClick={() => run(() => cancelPlate(props.id))}
                  disabled={pending}
                >
                  {pending && <span className="spinner" />}
                  {pending ? 'Cancelling…' : 'Yes, Cancel Plate'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const { date, meal, disabled = false, disabledReason } = props;
  const summary = summariseFlags(flags, other);

  function toggle(id: string) {
    if (disabled) return;
    setFlags((current) =>
      current.includes(id) ? current.filter((f) => f !== id) : [...current, id],
    );
  }

  const submit = () => {
    if (disabled) return;
    run(() => requestPlate(date, meal, note, flags, other));
  };

  return (
    <div className="lp-actions">
      <button
        className={`btn sm lp-primary ${disabled ? 'ghost' : 'gold'}`}
        type="button"
        disabled={pending || disabled}
        onClick={submit}
        title={disabled ? (disabledReason ?? 'Late plate requests are currently paused') : undefined}
      >
        {pending && <span className="spinner" />}
        {pending ? 'Sending…' : disabled ? 'Requests Paused' : 'Save me a plate'}
      </button>

      {disabled && (
        <div className="lp-msg" style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
          {disabledReason ?? 'Requests paused by kitchen manager for testing.'}
        </div>
      )}

      <button
        className={`lp-flag-summary${summary.hasAllergen ? ' has-allergen' : ''}`}
        type="button"
        onClick={() => setFlagsOpen((o) => !o)}
        aria-expanded={flagsOpen}
      >
        {summary.hasAny ? (
          <>
            <span className="lp-flag-list">{summary.lines.join(' · ')}</span>
            <span className="lp-flag-edit">{flagsOpen ? 'done' : 'change'}</span>
          </>
        ) : (
          <span className="lp-flag-edit">
            {flagsOpen ? 'done' : 'Add allergies or restrictions'}
          </span>
        )}
      </button>

      {flagsOpen && (
        <div className="lp-flag-panel">
          <div className="lp-flag-group-title">Allergies</div>
          <div className="lp-flag-grid">
            {ALLERGENS.map((f) => (
              <label key={f.id} className="lp-flag-check">
                <input
                  type="checkbox"
                  checked={flags.includes(f.id)}
                  onChange={() => toggle(f.id)}
                />
                <span>
                  {f.label}
                  {f.hint && <em>{f.hint}</em>}
                </span>
              </label>
            ))}
          </div>

          <div className="lp-flag-group-title">Dietary and religious</div>
          <div className="lp-flag-grid">
            {DIETARY.map((f) => (
              <label key={f.id} className="lp-flag-check">
                <input
                  type="checkbox"
                  checked={flags.includes(f.id)}
                  onChange={() => toggle(f.id)}
                />
                <span>
                  {f.label}
                  {f.hint && <em>{f.hint}</em>}
                </span>
              </label>
            ))}
          </div>

          {flags.includes(OTHER_FLAG_ID) && (
            <input
              className="field lp-note-field"
              placeholder="What should the chefs know?"
              value={other}
              maxLength={140}
              onChange={(e) => setOther(e.target.value)}
            />
          )}

          <div className="lp-flag-foot">
            These are saved as yours, so they will already be ticked next time.
          </div>
        </div>
      )}

      {!noteOpen ? (
        <button
          className="lp-note-toggle"
          type="button"
          onClick={() => setNoteOpen(true)}
        >
          Add a note
        </button>
      ) : (
        <input
          className="field lp-note-field"
          placeholder="e.g. grabbing it around 9"
          value={note}
          autoFocus
          maxLength={140}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      )}

      {message && (
        <div
          className="lp-msg"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </div>
      )}
    </div>
  );
}
