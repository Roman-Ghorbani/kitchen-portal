'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseISO, addDays } from '../../../../lib/dates.ts';

export interface WeekNavWeek {
  id: string;
  weekStart: string;
  status: string;
}

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function weekRangeLabel(iso: string): string {
  const start = parseISO(iso);
  const end = parseISO(addDays(iso, 6));
  const sStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const eStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${sStr} – ${eStr}`;
}

export function WeekNav({
  activeWeeks,
  archivedWeeks,
  currentMonday,
  selected,
}: {
  activeWeeks: WeekNavWeek[];
  archivedWeeks: WeekNavWeek[];
  currentMonday: string;
  selected: string;
}) {
  const router = useRouter();
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const isSelectedArchived = archivedWeeks.some((w) => w.weekStart === selected);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'nearest',
        block: 'nearest',
      });
    }
  }, [selected]);

  return (
    <div className="week-nav-bar">
      <div className="week-toggle-scroll" ref={scrollContainerRef}>
        <div className="week-toggle">
          {/* If the user navigated to an archived week, pin it as active in the toggle strip */}
          {isSelectedArchived && (
            <Link
              ref={activeRef}
              href={`/admin/week?week=${selected}`}
              className="active archived-pill"
            >
              <span>📁 {shortDate(selected)}</span>
              <span className="tag locked">Archived</span>
            </Link>
          )}

          {activeWeeks.map((w) => {
            const isSelected = w.weekStart === selected;
            const isCurrent = w.weekStart === currentMonday;
            const isNext = w.weekStart === addDays(currentMonday, 7);

            let label = shortDate(w.weekStart);
            if (isCurrent) {
              label = `This week (${shortDate(w.weekStart)})`;
            } else if (isNext) {
              label = `Next week (${shortDate(w.weekStart)})`;
            }

            const tagText = isCurrent
              ? 'Running'
              : w.status === 'posted'
                ? 'Open'
                : 'Finished';

            const tagClass = isCurrent
              ? 'ok'
              : w.status === 'posted'
                ? 'ok'
                : 'locked';

            return (
              <Link
                key={w.id}
                ref={isSelected ? activeRef : undefined}
                href={`/admin/week?week=${w.weekStart}`}
                className={isSelected ? 'active' : ''}
              >
                <span>{label}</span>
                <span className={`tag ${tagClass}`}>{tagText}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {archivedWeeks.length > 0 && (
        <div className="week-archive-picker">
          <label htmlFor="archived-weeks-select" className="visually-hidden">
            Archived past weeks
          </label>
          <div className="archive-select-wrapper">
            <span className="archive-select-icon" aria-hidden="true">📁</span>
            <select
              id="archived-weeks-select"
              className="week-archive-select"
              value={isSelectedArchived ? selected : ''}
              onChange={(e) => {
                if (e.target.value) {
                  router.push(`/admin/week?week=${e.target.value}`);
                }
              }}
            >
              <option value="" disabled={isSelectedArchived}>
                {isSelectedArchived
                  ? `Archived: ${shortDate(selected)}`
                  : `Past Weeks Archive (${archivedWeeks.length})`}
              </option>
              {archivedWeeks.map((w) => (
                <option key={w.id} value={w.weekStart}>
                  {weekRangeLabel(w.weekStart)} · Archived
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
