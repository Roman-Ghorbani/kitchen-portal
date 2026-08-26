'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  addRecurringLatePlate,
  removeRecurringLatePlate,
} from '../../actions/late-plate-actions.ts';
import type { RecurringLatePlateRow } from '../../../lib/late-plate-service.ts';
import type { Meal } from '../../../lib/types.ts';

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function RecurringSchedules({
  schedules,
  disabled = false,
}: {
  schedules: RecurringLatePlateRow[];
  disabled?: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(1); // Tuesday default
  const [meal, setMeal] = useState<Meal>('dinner');
  const [note, setNote] = useState('');
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function runAction(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) {
        setFormOpen(false);
        setShowWarningModal(false);
        setNote('');
        router.refresh();
      }
    });
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Show the confirmation popup warning modal
    setShowWarningModal(true);
  }

  function handleConfirmSave() {
    runAction(() => addRecurringLatePlate(dayOfWeek, meal, note));
  }

  const selectedDayName = WEEKDAYS[dayOfWeek];

  return (
    <div className="lp-recurring-section card card-pad">
      <div className="lp-recurring-head">
        <div>
          <div className="lp-eyebrow">Standing Schedules</div>
          <h2 className="lp-section-title">Recurring Weekly Late Plates</h2>
          <div className="lp-section-desc">
            Automatically request a late plate for regular weekly class conflicts or labs.
          </div>
        </div>

        {!formOpen && (
          <button
            type="button"
            className="btn sm ghost"
            disabled={disabled}
            onClick={() => setFormOpen(true)}
          >
            + Add Recurring Schedule
          </button>
        )}
      </div>

      {message && (
        <div
          className={`lp-msg`}
          style={{
            marginTop: 10,
            color: failed ? 'var(--red-600)' : 'var(--gold-400)',
          }}
        >
          {message}
        </div>
      )}

      {/* Active Schedules List */}
      {schedules.length === 0 && !formOpen ? (
        <div className="lp-recurring-empty">
          You don&apos;t have any recurring late plates set up.
        </div>
      ) : (
        <div className="lp-recurring-grid">
          {schedules.map((s) => (
            <div key={s.id} className="lp-recurring-item">
              <div className="lp-recurring-item-left">
                <span className="lp-recurring-icon">🔁</span>
                <div>
                  <div className="lp-recurring-name">
                    Every {WEEKDAYS[s.dayOfWeek]} ·{' '}
                    <span className="lp-recurring-meal">{s.meal}</span>
                  </div>
                  {s.note && (
                    <div className="lp-recurring-note">“{s.note}”</div>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="btn sm danger ghost"
                disabled={pending}
                onClick={() => runAction(() => removeRecurringLatePlate(s.id))}
                title="Remove this recurring schedule"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Schedule Form */}
      {formOpen && (
        <form onSubmit={handleFormSubmit} className="lp-recurring-form">
          <div className="lp-recurring-form-grid">
            <div>
              <label className="field-label">Weekday</label>
              <select
                className="field"
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                style={{ width: '100%' }}
              >
                {WEEKDAYS.slice(0, 5).map((d, i) => (
                  <option key={d} value={i}>
                    Every {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">Meal</label>
              <select
                className="field"
                value={meal}
                onChange={(e) => setMeal(e.target.value as Meal)}
                style={{ width: '100%' }}
              >
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="field-label">Reason / Note (Optional)</label>
            <input
              className="field"
              placeholder="e.g. Physics 8.02 lab until 6:00 PM"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%' }}
              maxLength={140}
            />
          </div>

          <div className="lp-recurring-form-actions">
            <button
              type="button"
              className="btn sm"
              onClick={() => setFormOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button type="submit" className="btn sm gold" disabled={pending}>
              Schedule Recurring Plate
            </button>
          </div>
        </form>
      )}

      {/* Warning Confirmation Modal Popup */}
      {showWarningModal && (
        <div className="claim-confirm-modal-overlay">
          <div className="claim-confirm-modal card card-pad" style={{ maxWidth: 480 }}>
            <div className="confirm-header">
              <span className="warning-icon">⚠️</span>
              <strong style={{ fontSize: 16 }}>
                Set Recurring Late Plate Schedule?
              </strong>
            </div>
            <div className="confirm-body" style={{ marginTop: 10 }}>
              <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-900)' }}>
                Are you sure you want to schedule a recurring late plate for every{' '}
                <strong>
                  {selectedDayName} {meal}
                </strong>
                ?
              </p>
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: 8,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  color: '#f87171',
                }}
              >
                <strong>Warning:</strong> If your schedule changes or you forget you
                have this scheduled because of a repeated conflict, the chefs will
                continue making your plate every single week and it will sit
                uncollected in the student fridge.
              </div>
            </div>
            <div
              className="confirm-actions"
              style={{
                marginTop: 16,
                display: 'flex',
                gap: 10,
                justifyContent: 'flex-end',
              }}
            >
              <button
                className="btn sm"
                type="button"
                onClick={() => setShowWarningModal(false)}
                disabled={pending}
              >
                Nevermind
              </button>
              <button
                className="btn sm gold"
                type="button"
                onClick={handleConfirmSave}
                disabled={pending}
              >
                {pending && <span className="spinner" />}
                {pending ? 'Scheduling…' : 'Yes, Schedule Recurring Plate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
