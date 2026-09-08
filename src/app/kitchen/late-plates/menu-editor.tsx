'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { mondayOf, addDays, weekDates, todayInEastern } from '../../../lib/dates.ts';

type MealName = 'lunch' | 'dinner';

interface DayMenuData {
  date: string;
  lunch: string[];
  dinner: string[];
}

interface MenuEditorProps {
  device: string;
  todayIso: string;
}

function parseDishes(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function prettyDayHeading(iso: string): { weekday: string; dateFormatted: string; fullDate: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    dateFormatted: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    fullDate: dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  };
}

function formatWeekRange(startIso: string): string {
  const endIso = addDays(startIso, 6);
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const sdt = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0));
  const edt = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));

  const startStr = sdt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endStr = edt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${startStr} – ${endStr}`;
}

export function MenuEditor({ device, todayIso }: MenuEditorProps) {
  const actualToday = todayIso || todayInEastern();
  const currentWeekMonday = mondayOf(actualToday);

  const [weekStart, setWeekStart] = useState<string>(currentWeekMonday);
  const [selectedDate, setSelectedDate] = useState<string>(actualToday);
  const [menusByDate, setMenusByDate] = useState<Record<string, DayMenuData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Textarea input buffers for the currently selected day
  const [lunchText, setLunchText] = useState('');
  const [dinnerText, setDinnerText] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch menus for a window around weekStart (past week, current week, next 2 weeks)
  const loadMenus = useCallback(async (baseWeekStart: string) => {
    try {
      setLoading(true);
      const startFetch = addDays(baseWeekStart, -7);
      const res = await fetch(
        `/api/menu?startDate=${startFetch}&days=28&device=${encodeURIComponent(device)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.days)) {
        const map: Record<string, DayMenuData> = {};
        for (const d of data.days) {
          map[d.date] = {
            date: d.date,
            lunch: d.lunch?.items || [],
            dinner: d.dinner?.items || [],
          };
        }
        setMenusByDate((prev) => ({ ...prev, ...map }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load menus');
    } finally {
      setLoading(false);
    }
  }, [device]);

  useEffect(() => {
    loadMenus(weekStart);
  }, [loadMenus, weekStart]);

  // Sync textarea buffers whenever selectedDate or menusByDate changes (if not actively dirty)
  useEffect(() => {
    const existing = menusByDate[selectedDate];
    const newLunch = (existing?.lunch || []).join('\n');
    const newDinner = (existing?.dinner || []).join('\n');

    setLunchText(newLunch);
    setDinnerText(newDinner);
    setIsDirty(false);
    setSaveStatus(null);
  }, [selectedDate, menusByDate]);

  // Direct save helper
  const performSave = useCallback(
    async (targetDate: string, lunchRaw: string, dinnerRaw: string) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      const lunchDishes = parseDishes(lunchRaw);
      const dinnerDishes = parseDishes(dinnerRaw);

      setSaving(true);
      setSaveStatus('saving');
      setError(null);

      try {
        const res = await fetch(`/api/menu?device=${encodeURIComponent(device)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: targetDate,
            lunch: lunchDishes,
            dinner: dinnerDishes,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to save menu');
        }

        // Update local cache
        setMenusByDate((prev) => ({
          ...prev,
          [targetDate]: {
            date: targetDate,
            lunch: lunchDishes,
            dinner: dinnerDishes,
          },
        }));

        setIsDirty(false);
        setSaveStatus('saved');
        setTimeout(() => {
          setSaveStatus((current) => (current === 'saved' ? null : current));
        }, 4000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save menu to server');
        setSaveStatus('unsaved');
      } finally {
        setSaving(false);
      }
    },
    [device],
  );

  // Trigger debounced auto-save when user types
  const handleInputChange = (meal: MealName, value: string) => {
    let nextLunch = lunchText;
    let nextDinner = dinnerText;

    if (meal === 'lunch') {
      setLunchText(value);
      nextLunch = value;
    } else {
      setDinnerText(value);
      nextDinner = value;
    }

    setIsDirty(true);
    setSaveStatus('unsaved');

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      performSave(selectedDate, nextLunch, nextDinner);
    }, 1200);
  };

  // Immediate save on blur
  const handleInputBlur = () => {
    if (isDirty) {
      performSave(selectedDate, lunchText, dinnerText);
    }
  };

  // Safe day transition: save current pending edits before changing date
  const handleSelectDate = (newDate: string) => {
    if (newDate === selectedDate) return;

    if (isDirty) {
      performSave(selectedDate, lunchText, dinnerText);
    }
    setSelectedDate(newDate);
  };

  // Week navigation
  const handleShiftWeek = (deltaWeeks: number) => {
    if (isDirty) {
      performSave(selectedDate, lunchText, dinnerText);
    }
    const newWeekStart = addDays(weekStart, deltaWeeks * 7);
    setWeekStart(newWeekStart);

    // Keep same weekday index in new week
    const currentDays = weekDates(weekStart);
    const dayIdx = currentDays.indexOf(selectedDate);
    const newDays = weekDates(newWeekStart);
    const newTargetDate = dayIdx >= 0 ? newDays[dayIdx] : newDays[0];
    setSelectedDate(newTargetDate);
  };

  const handleGoToThisWeek = () => {
    if (isDirty) {
      performSave(selectedDate, lunchText, dinnerText);
    }
    setWeekStart(currentWeekMonday);
    setSelectedDate(actualToday);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const daysInWeek = weekDates(weekStart);
  const dayHeading = prettyDayHeading(selectedDate);
  const isThisWeek = weekStart === currentWeekMonday;
  const isNextWeek = weekStart === addDays(currentWeekMonday, 7);

  const lunchDishesCount = parseDishes(lunchText).length;
  const dinnerDishesCount = parseDishes(dinnerText).length;

  return (
    <div className="kq-menu-editor">
      {/* Week Navigation Header */}
      <div className="kq-week-nav">
        <div className="kq-week-nav-controls">
          <button
            type="button"
            className="kq-btn kq-week-btn"
            onClick={() => handleShiftWeek(-1)}
            title="Previous Week"
          >
            ◀ Previous Week
          </button>

          <button
            type="button"
            className={`kq-btn kq-week-btn${isThisWeek ? ' kq-week-btn-active' : ''}`}
            onClick={handleGoToThisWeek}
          >
            📅 This Week
          </button>

          <button
            type="button"
            className={`kq-btn kq-week-btn${isNextWeek ? ' kq-week-btn-active' : ''}`}
            onClick={() => handleShiftWeek(1)}
            title="Next Week"
          >
            Next Week ▶
          </button>
        </div>

        <div className="kq-week-range">
          <span className="kq-week-range-text">{formatWeekRange(weekStart)}</span>
          {isThisWeek && <span className="kq-week-badge this-week">This Week</span>}
          {isNextWeek && <span className="kq-week-badge next-week">Next Week</span>}
        </div>
      </div>

      {/* 7-Day Day Selector Strip */}
      <div className="kq-menu-dates" role="tablist" aria-label="Select Day">
        {daysInWeek.map((iso) => {
          const isSelected = iso === selectedDate;
          const isToday = iso === actualToday;
          const [y, m, d] = iso.split('-').map(Number);
          const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
          const dayName = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
          const shortDate = dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

          const dayData = menusByDate[iso];
          const hasDishes = (dayData?.lunch?.length || 0) + (dayData?.dinner?.length || 0) > 0;
          const dishTotal = (dayData?.lunch?.length || 0) + (dayData?.dinner?.length || 0);

          return (
            <button
              key={iso}
              role="tab"
              aria-selected={isSelected}
              className={`kq-menu-date-btn${isSelected ? ' active' : ''}${isToday ? ' is-today' : ''}`}
              onClick={() => handleSelectDate(iso)}
            >
              <div className="kq-menu-date-label">
                {isToday ? 'Today' : dayName}
              </div>
              <div className="kq-menu-date-sub">{shortDate}</div>
              {hasDishes && (
                <div
                  className="kq-menu-date-dot"
                  title={`${dishTotal} dish${dishTotal === 1 ? '' : 'es'} configured`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Day Control Bar */}
      <div className="kq-menu-day-bar">
        <div className="kq-menu-day-info">
          <h2 className="kq-menu-day-title">
            {dayHeading.fullDate}
            {selectedDate === actualToday && <span className="kq-today-badge">TODAY</span>}
          </h2>
          <div className="kq-menu-day-desc">
            Changes appear immediately on the TV and brothers&apos; Late Plate app.
          </div>
        </div>

        <div className="kq-menu-day-actions">
          {saveStatus === 'saving' && (
            <span className="kq-sync-indicator saving">
              <span className="kq-sync-spinner" aria-hidden="true" />
              Saving…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="kq-sync-indicator saved">
              ✓ Saved
            </span>
          )}
          {saveStatus === 'unsaved' && (
            <span className="kq-sync-indicator unsaved">
              ● Auto-saving…
            </span>
          )}

          <button
            type="button"
            className="kq-btn ready kq-menu-save-btn"
            onClick={() => performSave(selectedDate, lunchText, dinnerText)}
            disabled={saving}
          >
            {saving ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved!' : '💾 Save Menu'}
          </button>
        </div>
      </div>

      {error && <div className="kq-error">{error}</div>}

      {/* Textarea Menu Input Grid */}
      <div className="kq-menu-grid">
        {/* Lunch Card */}
        <div className="kq-menu-card">
          <div className="kq-menu-card-head">
            <div>
              <span className="kq-menu-card-icon">☀️</span>
              <span className="kq-menu-card-title">Lunch Menu</span>
              <span className="kq-menu-card-time">11:00 AM – 2:30 PM</span>
            </div>
            <div className="kq-menu-card-badge">
              {lunchDishesCount > 0 ? `${lunchDishesCount} dish${lunchDishesCount === 1 ? '' : 'es'}` : 'Empty'}
            </div>
          </div>

          <div className="kq-menu-instruction">
            Enter one dish per line. Leave empty if no lunch is served.
          </div>

          <textarea
            className="kq-menu-box"
            rows={7}
            placeholder={`One dish per line...\nChicken Caesar Wrap\nPotato Chips\nFresh Fruit`}
            value={lunchText}
            onChange={(e) => handleInputChange('lunch', e.target.value)}
            onBlur={handleInputBlur}
            disabled={loading}
          />
        </div>

        {/* Dinner Card */}
        <div className="kq-menu-card">
          <div className="kq-menu-card-head">
            <div>
              <span className="kq-menu-card-icon">🌙</span>
              <span className="kq-menu-card-title">Dinner Menu</span>
              <span className="kq-menu-card-time">4:30 PM – 7:30 PM</span>
            </div>
            <div className="kq-menu-card-badge">
              {dinnerDishesCount > 0 ? `${dinnerDishesCount} dish${dinnerDishesCount === 1 ? '' : 'es'}` : 'Empty'}
            </div>
          </div>

          <div className="kq-menu-instruction">
            Enter one dish per line. Leave empty if no dinner is served.
          </div>

          <textarea
            className="kq-menu-box"
            rows={7}
            placeholder={`One dish per line...\nTeriyaki Salmon\nSteamed Jasmine Rice\nRoasted Broccoli`}
            value={dinnerText}
            onChange={(e) => handleInputChange('dinner', e.target.value)}
            onBlur={handleInputBlur}
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}
