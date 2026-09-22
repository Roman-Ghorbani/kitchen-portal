'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  adminPlacePlate,
  adminUpdateStatus,
} from '../../../actions/late-plate-actions.ts';
import {
  ALLERGENS,
  DIETARY,
  OTHER_FLAG_ID,
  summariseFlags,
} from '../../../../lib/dietary.ts';
import type { LatePlateRow, LatePlateStatus } from '../../../../lib/late-plate-service.ts';
import type { Meal } from '../../../../lib/types.ts';

interface MemberOption {
  id: string;
  name: string;
  dietaryFlags: string[] | null;
  dietaryOther: string | null;
}

export function LatePlateAdminClient({
  todayPlates,
  roster,
  today,
}: {
  todayPlates: LatePlateRow[];
  roster: MemberOption[];
  today: string;
}) {
  const [plates, setPlates] = useState<LatePlateRow[]>(todayPlates);
  const [mealFilter, setMealFilter] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | LatePlateStatus>('all');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Manual request form state
  const [selectedMemberId, setSelectedMemberId] = useState(roster[0]?.id ?? '');
  const [manualDate, setManualDate] = useState(today);
  const [manualMeal, setManualMeal] = useState<Meal>('dinner');
  const [manualNote, setManualNote] = useState('');
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [manualFlags, setManualFlags] = useState<string[]>([]);
  const [manualOther, setManualOther] = useState('');

  // Status decline prompt state
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  function runAction(fn: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const res = await fn();
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) {
        setDecliningId(null);
        setDeclineReason('');
        router.refresh();
      }
    });
  }

  function handleMemberSelect(memberId: string) {
    setSelectedMemberId(memberId);
    const m = roster.find((r) => r.id === memberId);
    if (m) {
      setManualFlags(m.dietaryFlags ?? []);
      setManualOther(m.dietaryOther ?? '');
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMemberId) return;

    runAction(() =>
      adminPlacePlate(
        selectedMemberId,
        manualDate,
        manualMeal,
        manualNote,
        manualFlags,
        manualOther,
      ),
    );
  }

  function toggleFlag(id: string) {
    setManualFlags((curr) =>
      curr.includes(id) ? curr.filter((f) => f !== id) : [...curr, id],
    );
  }

  const filteredPlates = plates.filter((p) => {
    if (mealFilter !== 'all' && p.meal !== mealFilter) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const flagSummary = summariseFlags(manualFlags, manualOther);

  return (
    <div className="lp-admin-container">
      {message && (
        <div
          className={`alert ${failed ? 'warn' : 'good'}`}
          style={{ marginBottom: 16 }}
        >
          <div className="alert-body">{message}</div>
        </div>
      )}

      {/* Queue Manager Card */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>
              Live Request Queue
            </h2>
            <div style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 2 }}>
              Manage and override status for today&apos;s late plates.
            </div>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="field"
              value={mealFilter}
              onChange={(e) => setMealFilter(e.target.value as any)}
              style={{ fontSize: 12.5, padding: '4px 8px' }}
            >
              <option value="all">All Meals</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
            </select>

            <select
              className="field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              style={{ fontSize: 12.5, padding: '4px 8px' }}
            >
              <option value="all">All Statuses</option>
              <option value="waiting">Waiting (To Make)</option>
              <option value="ready">Ready</option>
              <option value="declined">Declined</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {filteredPlates.length === 0 ? (
          <div className="note" style={{ marginTop: 16 }}>
            No late plate requests matching the selected filters.
          </div>
        ) : (
          <div className="lp-queue-list" style={{ marginTop: 16 }}>
            {filteredPlates.map((p) => (
              <div key={p.id} className={`lp-queue-card lp-row-${p.status}`}>
                <div className="lp-queue-card-header">
                  <div>
                    <div className="lp-queue-card-title">{p.name}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="lp-meal-chip">{p.meal}</span>
                      <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                        {new Date(p.requestedAt).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                  <div>
                    {p.status === 'ready' ? (
                      <span className="tag ok">Ready</span>
                    ) : p.status === 'waiting' ? (
                      <span className="tag jun">Waiting</span>
                    ) : p.status === 'declined' ? (
                      <span className="tag bad" title={p.reason ?? ''}>
                        Declined
                      </span>
                    ) : (
                      <span className="tag locked">Cancelled</span>
                    )}
                  </div>
                </div>

                {(p.flags.hasAny || p.note || (p.reason && p.status === 'declined')) && (
                  <div className="lp-queue-card-body">
                    {p.flags.hasAny && (
                      <div className="lp-flags-mini">
                        {p.flags.allergens.map((a) => (
                          <span key={a} className="lp-chip allergen" style={{ fontSize: 10 }}>
                            ⚠️ {a}
                          </span>
                        ))}
                        {p.flags.dietary.map((d) => (
                          <span key={d} className="lp-chip dietary" style={{ fontSize: 10 }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.note && <div style={{ fontStyle: 'italic', color: 'var(--ink-400)' }}>“{p.note}”</div>}
                    {p.reason && p.status === 'declined' && (
                      <div style={{ color: 'var(--red-600)' }}>Reason: {p.reason}</div>
                    )}
                  </div>
                )}

                <div className="lp-queue-card-actions">
                  {p.status === 'waiting' && (
                    <>
                      <button
                        type="button"
                        className="btn sm good"
                        disabled={pending}
                        onClick={() => runAction(() => adminUpdateStatus(p.id, 'ready'))}
                        title="Mark Ready in Student Fridge"
                      >
                        Mark Ready
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={pending}
                        onClick={() => setDecliningId(p.id)}
                      >
                        Decline
                      </button>
                    </>
                  )}

                  {p.status === 'ready' && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={pending}
                      onClick={() => runAction(() => adminUpdateStatus(p.id, 'waiting'))}
                    >
                      Revert to Waiting
                    </button>
                  )}

                  {p.status === 'declined' && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      disabled={pending}
                      onClick={() => runAction(() => adminUpdateStatus(p.id, 'waiting'))}
                    >
                      Re-Open
                    </button>
                  )}

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decline Reason Modal */}
      {decliningId && (
        <div className="claim-confirm-modal-overlay">
          <div className="claim-confirm-modal card card-pad" style={{ maxWidth: 440 }}>
            <div className="confirm-header">
              <strong>Decline Late Plate Request</strong>
            </div>
            <div className="confirm-body" style={{ marginTop: 10 }}>
              <p style={{ fontSize: 13 }}>Enter a reason shown to the member:</p>
              <input
                className="field"
                placeholder="e.g. Ran out of chicken / Kitchen closed early"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                style={{ width: '100%', marginTop: 8 }}
                autoFocus
              />
            </div>
            <div className="confirm-actions" style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn sm"
                type="button"
                onClick={() => setDecliningId(null)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                className="btn sm danger"
                type="button"
                disabled={pending}
                onClick={() =>
                  runAction(() => adminUpdateStatus(decliningId, 'declined', declineReason))
                }
              >
                Decline Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Request Input (Manager Override) */}
      <details className="card card-pad" style={{ marginBottom: 20, cursor: 'pointer' }}>
        <summary style={{ outline: 'none', userSelect: 'none' }}>
          <h2 className="section-title" style={{ margin: 0, display: 'inline-block' }}>
            Manual Request Placement (Manager Override)
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 4, fontWeight: 'normal' }}>
            Place a late plate on behalf of any brother. Bypasses cutoff times.
          </p>
        </summary>
        
        <div style={{ marginTop: 16, cursor: 'default' }}>
          <form onSubmit={handleManualSubmit}>
            <div className="lp-manual-grid">
              <div>
                <label className="field-label">Brother</label>
                <select
                  className="field"
                  value={selectedMemberId}
                  onChange={(e) => handleMemberSelect(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {roster.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Date</label>
                <input
                  type="date"
                  className="field"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label className="field-label">Meal</label>
                <select
                  className="field"
                  value={manualMeal}
                  onChange={(e) => setManualMeal(e.target.value as Meal)}
                  style={{ width: '100%' }}
                >
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="field-label">Note for Kitchen (Optional)</label>
              <input
                className="field"
                placeholder="e.g. Grabbing around 9 PM / Placed by manager"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setFlagsOpen((o) => !o)}
              >
                {flagSummary.hasAny
                  ? `Dietary Flags: ${flagSummary.lines.join(' · ')} (edit)`
                  : '+ Specify Dietary Restrictions'}
              </button>
            </div>

            {flagsOpen && (
              <div className="lp-flag-panel" style={{ marginTop: 10 }}>
                <div className="lp-flag-group-title">Allergens</div>
                <div className="lp-flag-grid">
                  {ALLERGENS.map((f) => (
                    <label key={f.id} className="lp-flag-check">
                      <input
                        type="checkbox"
                        checked={manualFlags.includes(f.id)}
                        onChange={() => toggleFlag(f.id)}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>

                <div className="lp-flag-group-title" style={{ marginTop: 8 }}>
                  Dietary & Religious
                </div>
                <div className="lp-flag-grid">
                  {DIETARY.map((f) => (
                    <label key={f.id} className="lp-flag-check">
                      <input
                        type="checkbox"
                        checked={manualFlags.includes(f.id)}
                        onChange={() => toggleFlag(f.id)}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>

                {manualFlags.includes(OTHER_FLAG_ID) && (
                  <input
                    className="field"
                    placeholder="Other restriction details"
                    value={manualOther}
                    onChange={(e) => setManualOther(e.target.value)}
                    style={{ marginTop: 8, width: '100%' }}
                  />
                )}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button
                type="submit"
                className="btn gold sm"
                disabled={pending || !selectedMemberId}
              >
                {pending ? 'Placing…' : 'Place Late Plate'}
              </button>
            </div>
          </form>
        </div>
      </details>
    </div>
  );
}
