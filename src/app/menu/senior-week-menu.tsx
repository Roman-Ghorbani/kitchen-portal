'use client';

import Link from 'next/link';
import { parseISO, addDays } from '../../lib/dates.ts';
import type { DayMenu } from '../../lib/menu-service.ts';

function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function fullDayHeading(iso: string): { weekday: string; dateStr: string } {
  const dt = parseISO(iso);
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    dateStr: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

export function SeniorWeekMenu({
  mode = 'standalone',
  weekStart,
  currentMonday,
  todayIso,
  days,
}: {
  mode?: 'standalone' | 'in-app';
  weekStart: string;
  currentMonday: string;
  todayIso: string;
  days: {
    date: string;
    isToday: boolean;
    isPast: boolean;
    menu: DayMenu | null;
  }[];
}) {
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);
  const isCurrentWeek = weekStart === currentMonday;
  const isNextWeek = weekStart === addDays(currentMonday, 7);

  const startLabel = shortDate(weekStart);
  const endLabel = shortDate(addDays(weekStart, 6));

  const weekControls = (
    <div className="senior-menu-nav">
      <div className="week-toggle">
        <Link
          href={`/menu?week=${currentMonday}`}
          className={isCurrentWeek ? 'active' : ''}
        >
          This week
        </Link>
        <Link
          href={`/menu?week=${addDays(currentMonday, 7)}`}
          className={isNextWeek ? 'active' : ''}
        >
          Next week
        </Link>
      </div>

      <div className="senior-menu-arrows">
        <Link
          href={`/menu?week=${prevWeek}`}
          className="btn sm"
          title="Previous week"
        >
          ←
        </Link>
        <Link
          href={`/menu?week=${nextWeek}`}
          className="btn sm"
          title="Next week"
        >
          →
        </Link>
      </div>
    </div>
  );

  return (
    <div className={mode === 'standalone' ? 'senior-menu-page' : 'in-app-menu-container'}>
      {mode === 'standalone' ? (
        <header className="senior-menu-header">
          <div className="senior-menu-brand">
            <div className="brand-mark">ZBT</div>
            <div>
              <h1 className="senior-menu-title">ZBT Kitchen Menu</h1>
              <div className="senior-menu-sub">
                {startLabel} – {endLabel} · Fall 2026
              </div>
            </div>
          </div>

          {weekControls}
        </header>
      ) : (
        <div className="in-app-menu-nav-bar">
          <div className="in-app-menu-sub mono">
            {startLabel} – {endLabel}
          </div>
          {weekControls}
        </div>
      )}

      <main className="senior-menu-days">
        {days.map((day) => {
          const { weekday, dateStr } = fullDayHeading(day.date);
          const lunchItems = day.menu?.lunch.items ?? [];
          const dinnerItems = day.menu?.dinner.items ?? [];
          const hasAnyItems = lunchItems.length > 0 || dinnerItems.length > 0;

          return (
            <section
              key={day.date}
              className={`card senior-day-card${day.isToday ? ' is-today' : ''}${day.isPast ? ' is-past' : ''}`}
            >
              <div className="senior-day-header">
                <div className="senior-day-title">
                  <span className="senior-day-weekday">{weekday}</span>
                  <span className="senior-day-date">{dateStr}</span>
                </div>
                {day.isToday && <span className="tag ok">⭐ Today</span>}
              </div>

              {!hasAnyItems ? (
                <div className="senior-empty-menu">
                  <span>No menu posted yet for this day.</span>
                </div>
              ) : (
                <div className="senior-meals-grid">
                  {/* Lunch Block */}
                  <div className="senior-meal-box">
                    <div className="senior-meal-head">
                      <span className="senior-meal-name">☀️ Lunch</span>
                      <span className="senior-meal-time">
                        {day.menu?.lunch.serve || '11:00 AM – 2:30 PM'}
                      </span>
                    </div>

                    {lunchItems.length === 0 ? (
                      <div className="senior-meal-empty">No lunch menu entered</div>
                    ) : (
                      <ul className="senior-dish-list">
                        {lunchItems.map((dish, idx) => (
                          <li key={idx} className="senior-dish-item">
                            <span className="senior-dish-bullet">•</span>
                            <span className="senior-dish-text">{dish}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Dinner Block */}
                  <div className="senior-meal-box">
                    <div className="senior-meal-head">
                      <span className="senior-meal-name">🌙 Dinner</span>
                      <span className="senior-meal-time">
                        {day.menu?.dinner.serve || '4:30 PM – 7:30 PM'}
                      </span>
                    </div>

                    {dinnerItems.length === 0 ? (
                      <div className="senior-meal-empty">No dinner menu entered</div>
                    ) : (
                      <ul className="senior-dish-list">
                        {dinnerItems.map((dish, idx) => (
                          <li key={idx} className="senior-dish-item">
                            <span className="senior-dish-bullet">•</span>
                            <span className="senior-dish-text">{dish}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </main>

      <footer className="senior-menu-footer">
        <div className="senior-footer-note">
          Note that the chefs update the menu here themselves. They will post it here before they send it to me.
        </div>
      </footer>
    </div>
  );
}
