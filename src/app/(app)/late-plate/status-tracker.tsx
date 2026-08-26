'use client';

import { formatClock, parseClock } from '../../../lib/dates.ts';
import type { LatePlateRow, MealWindow } from '../../../lib/late-plate-service.ts';
import type { DayMenu } from '../../../lib/menu-service.ts';
import { PlateButton } from './plate-button.tsx';

function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}

function clock(hhmm: string): string {
  const m = parseClock(hhmm);
  return m === null ? hhmm : formatClock(m);
}

export function StatusTracker({
  request,
  window,
  menu,
  isToday = true,
}: {
  request: LatePlateRow;
  window?: MealWindow;
  menu?: DayMenu | null;
  isToday?: boolean;
}) {
  const isReady = request.status === 'ready';
  const isWaiting = request.status === 'waiting';
  const isDeclined = request.status === 'declined';
  const isCancelled = request.status === 'cancelled';

  const menuItems = menu?.[request.meal]?.items ?? [];

  return (
    <div className={`lp-status-tracker-card is-${request.status}`}>
      <div className="lp-status-header">
        <div className="lp-status-title-group">
          <span className="lp-meal-icon">{request.meal === 'lunch' ? '☀️' : '🌙'}</span>
          <div>
            <div className="lp-status-meal-badge">{request.meal} Late Plate</div>
            <h3 className="lp-status-title">
              {isReady
                ? 'Ready for Pickup!'
                : isWaiting
                ? 'Requested · In Kitchen Queue'
                : isDeclined
                ? 'Request Declined by Kitchen'
                : 'Request Cancelled'}
            </h3>
          </div>
        </div>

        <div className="lp-status-pill">
          {isReady ? (
            <span className="tag ok">✓ Ready for Pickup</span>
          ) : isWaiting ? (
            <span className="tag jun">⏳ In Queue</span>
          ) : isDeclined ? (
            <span className="tag bad">Declined</span>
          ) : (
            <span className="tag locked">Cancelled</span>
          )}
        </div>
      </div>

      {/* Visual Step Progress Tracker */}
      {!isDeclined && !isCancelled && (
        <div className="lp-tracker-steps">
          <div className="lp-step is-complete">
            <div className="lp-step-dot">✓</div>
            <div className="lp-step-info">
              <div className="lp-step-label">Submitted</div>
              <div className="lp-step-time">{formatTime(request.requestedAt)}</div>
            </div>
          </div>

          <div className="lp-step-connector is-active" />

          <div className={`lp-step ${isReady ? 'is-complete' : 'is-current'}`}>
            <div className="lp-step-dot">{isReady ? '✓' : '2'}</div>
            <div className="lp-step-info">
              <div className="lp-step-label">Kitchen Queue</div>
              <div className="lp-step-time">
                {isReady ? 'Boxed' : 'Being boxed'}
              </div>
            </div>
          </div>

          <div className="lp-step-connector" />

          <div className={`lp-step ${isReady ? 'is-complete is-ready' : 'is-pending'}`}>
            <div className="lp-step-dot">{isReady ? '🍽️' : '3'}</div>
            <div className="lp-step-info">
              <div className="lp-step-label">Student Fridge</div>
              <div className="lp-step-time">
                {isReady && request.resolvedAt
                  ? `Plated at ${formatTime(request.resolvedAt)}`
                  : 'Ready in fridge'}
              </div>
            </div>
          </div>
        </div>
      )}

      {isReady && (
        <div className="lp-ready-banner">
          <div className="lp-ready-icon">🧊</div>
          <div>
            <div className="lp-ready-heading">Your plate is in the student fridge!</div>
            <div className="lp-ready-sub">
              {request.acknowledgedBy
                ? `Dietary restrictions verified by chef (${request.acknowledgedBy}). Grab it anytime!`
                : 'Boxed and labeled with your name in the student fridge.'}
            </div>
          </div>
        </div>
      )}

      {isDeclined && (
        <div className="lp-declined-box">
          <div className="lp-declined-heading">The kitchen could not fulfill this request:</div>
          <div className="lp-declined-reason">{request.reason || 'No specific reason provided.'}</div>
        </div>
      )}

      {isCancelled && (
        <div className="lp-cancelled-box">
          <div className="lp-cancelled-heading">You cancelled this late plate request.</div>
          {isToday && (
            <div className="lp-cancelled-sub">
              Since this was cancelled on the day of service, re-requesting this meal today is not permitted.
            </div>
          )}
        </div>
      )}

      {/* Details Grid */}
      <div className="lp-status-details">
        <div className="lp-detail-item">
          <div className="lp-detail-label">Service Window</div>
          <div className="lp-detail-value">
            {request.meal === 'lunch' ? 'Lunch' : 'Dinner'}
            {window ? ` · Requests closed at ${clock(window.cutoff)}` : ''}
          </div>
        </div>

        {menuItems.length > 0 && (
          <div className="lp-detail-item">
            <div className="lp-detail-label">On The Menu</div>
            <div className="lp-detail-value lp-menu-preview">
              {menuItems.join(' · ')}
            </div>
          </div>
        )}

        {request.flags.hasAny && (
          <div className="lp-detail-item">
            <div className="lp-detail-label">
              {request.acknowledgedAt ? 'Confirmed Dietary Flags' : 'Dietary Restrictions'}
            </div>
            <div className="lp-flags-chips">
              {request.flags.allergens.map((a) => (
                <span key={a} className="lp-chip allergen">
                  ⚠️ {a}
                </span>
              ))}
              {request.flags.dietary.map((d) => (
                <span key={d} className="lp-chip dietary">
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        {request.note && (
          <div className="lp-detail-item">
            <div className="lp-detail-label">Your Note</div>
            <div className="lp-detail-value lp-note-quote">“{request.note}”</div>
          </div>
        )}
      </div>

      {/* Action footer */}
      {!isCancelled && !isDeclined && (
        <div className="lp-status-actions">
          <PlateButton
            mode="cancel"
            id={request.id}
            alreadyReady={request.status === 'ready'}
            isDayOf={isToday}
          />
        </div>
      )}
    </div>
  );
}
