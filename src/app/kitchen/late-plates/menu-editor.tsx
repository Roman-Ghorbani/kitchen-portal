'use client';

import { useState, useEffect, useCallback } from 'react';

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

function addDaysISO(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function prettyDateLabel(iso: string): { weekday: string; dateFormatted: string; isToday: boolean } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    dateFormatted: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    isToday: false,
  };
}

export function MenuEditor({ device, todayIso }: MenuEditorProps) {
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [menusByDate, setMenusByDate] = useState<Record<string, DayMenuData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Quick-add inputs for the current view
  const [lunchInput, setLunchInput] = useState('');
  const [dinnerInput, setDinnerInput] = useState('');

  // Bulk paste modal
  const [pastingMeal, setPastingMeal] = useState<MealName | null>(null);
  const [pasteText, setPasteText] = useState('');

  // Generate a 7-day strip starting today
  const dayTabs = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysISO(todayIso, i);
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const shortDate = dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    return {
      iso,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayName,
      sub: shortDate,
      isToday: i === 0,
    };
  });

  const loadMenus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/menu?days=7&device=${encodeURIComponent(device)}`, {
        cache: 'no-store',
      });
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
    loadMenus();
  }, [loadMenus]);

  const currentMenu: DayMenuData = menusByDate[selectedDate] || {
    date: selectedDate,
    lunch: [],
    dinner: [],
  };

  const updateMealDishes = (meal: MealName, newDishes: string[]) => {
    setMenusByDate((prev) => ({
      ...prev,
      [selectedDate]: {
        ...currentMenu,
        [meal]: newDishes,
      },
    }));
    setSaveStatus(null);
  };

  const handleAddDish = (meal: MealName) => {
    const input = meal === 'lunch' ? lunchInput : dinnerInput;
    const trimmed = input.trim();
    if (!trimmed) return;

    const list = [...(currentMenu[meal] || []), trimmed];
    updateMealDishes(meal, list);

    if (meal === 'lunch') setLunchInput('');
    else setDinnerInput('');
  };

  const handleRemoveDish = (meal: MealName, index: number) => {
    const list = [...(currentMenu[meal] || [])];
    list.splice(index, 1);
    updateMealDishes(meal, list);
  };

  const handleClearMeal = (meal: MealName) => {
    updateMealDishes(meal, []);
  };

  const handleSaveDay = async () => {
    setSaving(true);
    setSaveStatus('Saving…');
    setError(null);
    try {
      const res = await fetch(`/api/menu?device=${encodeURIComponent(device)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          lunch: currentMenu.lunch,
          dinner: currentMenu.dinner,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Save failed');
      }
      setSaveStatus('✓ Saved! TV board and app updated.');
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save menu to server');
      setSaveStatus(null);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPreviousDay = () => {
    const prevDate = addDaysISO(selectedDate, -1);
    const prev = menusByDate[prevDate];
    if (!prev || (prev.lunch.length === 0 && prev.dinner.length === 0)) {
      alert('No menu found for the previous day to copy.');
      return;
    }
    setMenusByDate((old) => ({
      ...old,
      [selectedDate]: {
        date: selectedDate,
        lunch: [...prev.lunch],
        dinner: [...prev.dinner],
      },
    }));
    setSaveStatus('Copied from previous day. Click "Save Menu" to apply.');
  };

  const handleApplyPaste = () => {
    if (!pastingMeal) return;
    const lines = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    updateMealDishes(pastingMeal, lines);
    setPastingMeal(null);
    setPasteText('');
  };

  const selectedInfo = prettyDateLabel(selectedDate);

  return (
    <div className="kq-menu-editor">
      {/* Date Navigation Strip */}
      <div className="kq-menu-dates" role="tablist" aria-label="Select Date">
        {dayTabs.map((tab) => {
          const isSel = tab.iso === selectedDate;
          const dayData = menusByDate[tab.iso];
          const count = (dayData?.lunch?.length || 0) + (dayData?.dinner?.length || 0);

          return (
            <button
              key={tab.iso}
              role="tab"
              aria-selected={isSel}
              className={`kq-menu-date-btn${isSel ? ' active' : ''}`}
              onClick={() => {
                setSelectedDate(tab.iso);
                setSaveStatus(null);
              }}
            >
              <div className="kq-menu-date-label">{tab.label}</div>
              <div className="kq-menu-date-sub">{tab.sub}</div>
              {count > 0 && <div className="kq-menu-date-dot" title={`${count} dishes posted`} />}
            </button>
          );
        })}
      </div>

      {/* Selected Day Header */}
      <div className="kq-menu-day-bar">
        <div>
          <h2 className="kq-menu-day-title">
            {selectedInfo.weekday}, {selectedInfo.dateFormatted}
            {selectedDate === todayIso && <span className="kq-today-badge">TODAY</span>}
          </h2>
          <div className="kq-menu-day-desc">
            Configure dishes for this day. Changes appear immediately on the TV and Brother app.
          </div>
        </div>

        <div className="kq-menu-day-actions">
          <button
            type="button"
            className="kq-btn ghost"
            onClick={handleCopyPreviousDay}
            disabled={saving}
          >
            📋 Copy Yesterday
          </button>
          <button
            type="button"
            className="kq-btn ready kq-menu-save-btn"
            onClick={handleSaveDay}
            disabled={saving}
          >
            {saving ? 'Saving…' : '💾 Save Menu'}
          </button>
        </div>
      </div>

      {saveStatus && <div className="kq-save-banner">{saveStatus}</div>}
      {error && <div className="kq-error">{error}</div>}

      {/* Lunch and Dinner Cards Grid */}
      <div className="kq-menu-grid">
        {/* Lunch Card */}
        <div className="kq-menu-card">
          <div className="kq-menu-card-head">
            <div>
              <span className="kq-menu-card-icon">☀️</span>
              <span className="kq-menu-card-title">Lunch Menu</span>
              <span className="kq-menu-card-time">11:00 AM – 2:30 PM</span>
            </div>
            <div className="kq-menu-card-head-actions">
              <button
                type="button"
                className="kq-btn sm ghost"
                onClick={() => {
                  setPastingMeal('lunch');
                  setPasteText(currentMenu.lunch.join('\n'));
                }}
              >
                ✏️ Bulk Paste
              </button>
              {currentMenu.lunch.length > 0 && (
                <button
                  type="button"
                  className="kq-btn sm decline"
                  onClick={() => handleClearMeal('lunch')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Dishes List */}
          <div className="kq-menu-dish-list">
            {currentMenu.lunch.length === 0 ? (
              <div className="kq-menu-empty-meal">
                No dishes entered for lunch yet. Type a dish below or use Bulk Paste.
              </div>
            ) : (
              currentMenu.lunch.map((dish, idx) => (
                <div key={idx} className="kq-dish-row">
                  <span className="kq-dish-bullet">•</span>
                  <span className="kq-dish-name">{dish}</span>
                  <button
                    type="button"
                    className="kq-dish-del"
                    aria-label={`Remove ${dish}`}
                    onClick={() => handleRemoveDish('lunch', idx)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Quick Add Bar */}
          <div className="kq-dish-input-bar">
            <input
              type="text"
              className="kq-dish-input"
              placeholder="e.g. Chicken Caesar Wrap..."
              value={lunchInput}
              onChange={(e) => setLunchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDish('lunch');
                }
              }}
            />
            <button
              type="button"
              className="kq-btn ready sm"
              onClick={() => handleAddDish('lunch')}
              disabled={!lunchInput.trim()}
            >
              + Add Dish
            </button>
          </div>
        </div>

        {/* Dinner Card */}
        <div className="kq-menu-card">
          <div className="kq-menu-card-head">
            <div>
              <span className="kq-menu-card-icon">🌙</span>
              <span className="kq-menu-card-title">Dinner Menu</span>
              <span className="kq-menu-card-time">4:30 PM – 7:30 PM</span>
            </div>
            <div className="kq-menu-card-head-actions">
              <button
                type="button"
                className="kq-btn sm ghost"
                onClick={() => {
                  setPastingMeal('dinner');
                  setPasteText(currentMenu.dinner.join('\n'));
                }}
              >
                ✏️ Bulk Paste
              </button>
              {currentMenu.dinner.length > 0 && (
                <button
                  type="button"
                  className="kq-btn sm decline"
                  onClick={() => handleClearMeal('dinner')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Dishes List */}
          <div className="kq-menu-dish-list">
            {currentMenu.dinner.length === 0 ? (
              <div className="kq-menu-empty-meal">
                No dishes entered for dinner yet. Type a dish below or use Bulk Paste.
              </div>
            ) : (
              currentMenu.dinner.map((dish, idx) => (
                <div key={idx} className="kq-dish-row">
                  <span className="kq-dish-bullet">•</span>
                  <span className="kq-dish-name">{dish}</span>
                  <button
                    type="button"
                    className="kq-dish-del"
                    aria-label={`Remove ${dish}`}
                    onClick={() => handleRemoveDish('dinner', idx)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Quick Add Bar */}
          <div className="kq-dish-input-bar">
            <input
              type="text"
              className="kq-dish-input"
              placeholder="e.g. Teriyaki Salmon, Steamed Rice, Broccoli..."
              value={dinnerInput}
              onChange={(e) => setDinnerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddDish('dinner');
                }
              }}
            />
            <button
              type="button"
              className="kq-btn ready sm"
              onClick={() => handleAddDish('dinner')}
              disabled={!dinnerInput.trim()}
            >
              + Add Dish
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Paste Modal */}
      {pastingMeal && (
        <div className="kq-modal-scrim" role="dialog" aria-modal="true">
          <div className="kq-modal">
            <h2>Paste {pastingMeal === 'lunch' ? 'Lunch' : 'Dinner'} Dishes</h2>
            <p className="kq-modal-lead">
              Type or paste dishes, one dish per line.
            </p>

            <textarea
              className="kq-paste-textarea"
              rows={8}
              placeholder="Dish 1&#10;Dish 2&#10;Side dish..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              autoFocus
            />

            <div className="kq-modal-actions">
              <button
                type="button"
                className="kq-btn ghost"
                onClick={() => {
                  setPastingMeal(null);
                  setPasteText('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="kq-btn ready"
                onClick={handleApplyPaste}
              >
                Apply Dishes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
