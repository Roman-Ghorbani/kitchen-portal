'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { mondayOf, addDays, weekDates, todayInEastern } from '../../../lib/dates.ts';

type MealName = 'lunch' | 'dinner';

interface MealDraft {
  lunch: string;
  dinner: string;
}

interface MenuEditorProps {
  todayIso: string;
}

/**
 * Whether a menu is part-typed right now.
 *
 * Module scope on purpose: the kiosk shell reloads itself at 4am and again
 * after a long outage, and both of those would otherwise throw away whatever a
 * chef had half-written. They check this before pulling the rug.
 */
let menuIsDirty = false;
export function hasUnsavedMenu(): boolean {
  return menuIsDirty;
}

function parseDishes(text: string): string[] {
  return (text || '')
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

export function MenuEditor({ todayIso }: MenuEditorProps) {
  const actualToday = todayIso || todayInEastern();
  const currentWeekMonday = mondayOf(actualToday);

  const [weekStart, setWeekStart] = useState<string>(currentWeekMonday);
  const [selectedDate, setSelectedDate] = useState<string>(actualToday);

  // User typing buffer: untouched by background saves
  const [draftsByDate, setDraftsByDate] = useState<Record<string, MealDraft>>({});
  const [savedCounts, setSavedCounts] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Saved" used to fade after three seconds. On a screen nobody ever reloads,
  // a chef who typed and walked away then has no way to tell it landed.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const draftsRef = useRef(draftsByDate);
  draftsRef.current = draftsByDate;

  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDirtyRef = useRef(false);

  // Fetch menus for a window around weekStart
  const loadMenus = useCallback(async (baseWeekStart: string) => {
    try {
      setLoading(true);
      const startFetch = addDays(baseWeekStart, -7);
      const res = await fetch(
        `/api/menu?startDate=${startFetch}&days=28`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.days)) {
        const countsMap: Record<string, number> = {};

        setDraftsByDate((prev) => {
          const next = { ...prev };
          for (const d of data.days) {
            const lunchDishes = d.lunch?.items || [];
            const dinnerDishes = d.dinner?.items || [];
            countsMap[d.date] = lunchDishes.length + dinnerDishes.length;

            // Only initialize draft if user hasn't edited it yet
            if (next[d.date] === undefined) {
              next[d.date] = {
                lunch: lunchDishes.join('\n'),
                dinner: dinnerDishes.join('\n'),
              };
            }
          }
          return next;
        });

        setSavedCounts((prev) => ({ ...prev, ...countsMap }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load menus');
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * Follow the real today.
   *
   * This used to run only when `todayIso` changed, and skipped entirely if
   * anything was part-typed. A chef who left a half-written menu open pinned
   * the kiosk to a stale day for good - and since the kiosk is never reloaded,
   * the next morning it was still sitting on yesterday. It now keeps checking,
   * so the moment the draft saves itself the screen catches up on its own.
   */
  useEffect(() => {
    const settle = () => {
      if (isDirtyRef.current) return;
      const liveToday = todayIso || todayInEastern();
      setSelectedDate((cur) => (cur === liveToday ? cur : liveToday));
      setWeekStart((cur) => {
        const liveMonday = mondayOf(liveToday);
        return cur === liveMonday ? cur : liveMonday;
      });
    };

    settle();
    const timer = setInterval(settle, 30_000);
    return () => clearInterval(timer);
  }, [todayIso]);

  // When screen wakes up or gains focus while on menu tab, refresh menus and align current week
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        const liveToday = todayIso || todayInEastern();
        const liveMonday = mondayOf(liveToday);
        if (!isDirtyRef.current) {
          setSelectedDate(liveToday);
          setWeekStart(liveMonday);
        }
        loadMenus(liveMonday);
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [loadMenus, todayIso]);

  useEffect(() => {
    loadMenus(weekStart);
  }, [loadMenus, weekStart]);

  // Direct save helper - sends text without overwriting user's active draft
  const performSave = useCallback(
    async (targetDate: string) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      const currentDraft = draftsRef.current[targetDate] || { lunch: '', dinner: '' };
      const lunchDishes = parseDishes(currentDraft.lunch);
      const dinnerDishes = parseDishes(currentDraft.dinner);

      setSaving(true);
      setSaveStatus('saving');
      setError(null);

      try {
        const res = await fetch('/api/menu', {
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

        // Update badge count
        setSavedCounts((prev) => ({
          ...prev,
          [targetDate]: lunchDishes.length + dinnerDishes.length,
        }));

        isDirtyRef.current = false;
        menuIsDirty = false;
        setLastSavedAt(new Date());
        setSaveStatus('saved');
        // The transient tick fades, but the "Saved 6:24 PM" stamp stays.
        setTimeout(() => {
          setSaveStatus((current) => (current === 'saved' ? null : current));
        }, 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save menu to server');
        setSaveStatus('unsaved');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  // Trigger debounced auto-save when user types
  const handleInputChange = (meal: MealName, value: string) => {
    const current = draftsRef.current[selectedDate] || { lunch: '', dinner: '' };
    const updated = {
      ...current,
      [meal]: value,
    };

    setDraftsByDate((prev) => ({
      ...prev,
      [selectedDate]: updated,
    }));

    isDirtyRef.current = true;
    menuIsDirty = true;
    setSaveStatus('unsaved');

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      performSave(selectedDateRef.current);
    }, 1500);
  };

  // Immediate save on blur
  const handleInputBlur = () => {
    if (isDirtyRef.current) {
      performSave(selectedDateRef.current);
    }
  };

  // Safe day transition
  const handleSelectDate = (newDate: string) => {
    if (newDate === selectedDate) return;

    if (isDirtyRef.current) {
      performSave(selectedDateRef.current);
    }
    setSelectedDate(newDate);
    setSaveStatus(null);
  };

  // Week navigation
  const handleShiftWeek = (deltaWeeks: number) => {
    if (isDirtyRef.current) {
      performSave(selectedDateRef.current);
    }
    const newWeekStart = addDays(weekStart, deltaWeeks * 7);
    setWeekStart(newWeekStart);

    const currentDays = weekDates(weekStart);
    const dayIdx = currentDays.indexOf(selectedDate);
    const newDays = weekDates(newWeekStart);
    const newTargetDate = dayIdx >= 0 ? newDays[dayIdx] : newDays[0];
    setSelectedDate(newTargetDate);
    setSaveStatus(null);
  };

  const handleGoToThisWeek = () => {
    if (isDirtyRef.current) {
      performSave(selectedDateRef.current);
    }
    const liveToday = todayIso || todayInEastern();
    setWeekStart(mondayOf(liveToday));
    setSelectedDate(liveToday);
    setSaveStatus(null);
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

  const activeDraft = draftsByDate[selectedDate] || { lunch: '', dinner: '' };
  const lunchDishesCount = parseDishes(activeDraft.lunch).length;
  const dinnerDishesCount = parseDishes(activeDraft.dinner).length;

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

          const totalDishes = savedCounts[iso] || 0;
          const hasDishes = totalDishes > 0;

          return (
            <button
              key={iso}
              role="tab"
              aria-selected={isSelected}
              className={`kq-menu-date-btn${isSelected ? ' active' : ''}${isToday ? ' is-today' : ''}`}
              onClick={() => handleSelectDate(iso)}
            >
              {/* The weekday stays put. Replacing it with the word "Today"
                  took the day name away from the one day that matters most. */}
              {isToday && <span className="kq-menu-today-flag">TODAY</span>}
              <div className="kq-menu-date-label">{dayName}</div>
              <div className="kq-menu-date-sub">{shortDate}</div>
              <div className={`kq-menu-date-count${hasDishes ? '' : ' empty'}`}>
                {hasDishes ? `${totalDishes} dish${totalDishes === 1 ? '' : 'es'}` : 'Not set'}
              </div>
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
          {saveStatus !== 'saving' && saveStatus !== 'unsaved' && lastSavedAt && (
            <span className="kq-sync-indicator saved">
              ✓ Saved{' '}
              {lastSavedAt.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          )}
          {saveStatus === 'unsaved' && (
            <span className="kq-sync-indicator unsaved">
              ● Auto-saving…
            </span>
          )}

          {error && (
            <button
              type="button"
              className="kq-btn ready kq-menu-retry-btn"
              onClick={() => performSave(selectedDate)}
              disabled={saving}
            >
              💾 Retry Save
            </button>
          )}
        </div>
      </div>

      {error && <div className="kq-error">{error}</div>}

      {/* Textarea Menu Input Grid */}
      <div className="kq-menu-grid">
        {/* Lunch Card */}
        <div className="kq-menu-card">
          <div className="kq-menu-card-head">
            <div className="kq-menu-card-head-left">
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
            placeholder={`Type dishes here, one per line...\ne.g. Chicken Caesar Wrap\nChips\nFruit`}
            value={activeDraft.lunch}
            onChange={(e) => handleInputChange('lunch', e.target.value)}
            onBlur={handleInputBlur}
            disabled={loading}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="sentences"
          />
        </div>

        {/* Dinner Card */}
        <div className="kq-menu-card">
          <div className="kq-menu-card-head">
            <div className="kq-menu-card-head-left">
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
            placeholder={`Type dishes here, one per line...\ne.g. Teriyaki Salmon\nSteamed Jasmine Rice\nRoasted Broccoli`}
            value={activeDraft.dinner}
            onChange={(e) => handleInputChange('dinner', e.target.value)}
            onBlur={handleInputBlur}
            disabled={loading}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="sentences"
          />
        </div>
      </div>
    </div>
  );
}
