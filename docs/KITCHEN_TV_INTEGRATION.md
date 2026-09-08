# ZBTAA Kitchen TV Integration Guide

This guide explains how `kitchen-tv` ([https://github.com/ZBTAA/kitchen-tv](https://github.com/ZBTAA/kitchen-tv)) can connect to the ZBT Kitchen Tracker API to poll live duty schedules and display them on the chapter house TV.

---

## Endpoint Details

- **Live URL**: `https://kitchen.zbtaa.online/api/tv/schedule` (or `https://kitchen.zbtaa.online/api/tv`)
- **Local Dev URL**: `http://localhost:3000/api/tv/schedule`
- **Method**: `GET` (Preflight `OPTIONS` supported)
- **CORS**: `Access-Control-Allow-Origin: *` enabled for all origins.
- **Recommended Refresh Rate**: Every 120 seconds (2 minutes).

---

## Authentication

- **Default**: Public (no headers or keys needed).
- **Optional API Key**: If the server has `TV_API_KEY` set in `.env.local`, pass the key using any of these methods:
  - Query Parameter: `?key=YOUR_SECRET_KEY`
  - Header: `x-api-key: YOUR_SECRET_KEY`
  - Authorization Header: `Authorization: Bearer YOUR_SECRET_KEY`

---

## JSON Response Schema

```json
{
  "success": true,
  "timestamp": "2026-08-24T17:05:00.000Z",
  "timezone": "America/New_York",
  "pollIntervalSeconds": 120,
  "semester": {
    "id": "semester-uuid",
    "name": "Fall 2026"
  },
  "today": {
    "date": "2026-08-24",
    "dayOfWeek": "Monday",
    "isToday": true,
    "menu": {
      "hasMenu": true,
      "lunch": ["Chicken Caesar Wraps", "French Fries"],
      "dinner": ["Teriyaki Salmon", "Steamed Jasmine Rice", "Roasted Broccoli"]
    },
    "lunch": {
      "id": "slot-uuid-1",
      "meal": "lunch",
      "mealLabel": "Lunch Cleanup",
      "time": "2:30 PM – 3:00 PM",
      "dutyGroup": "Juniors",
      "size": 2,
      "coverBounty": 1,
      "menu": ["Chicken Caesar Wraps", "French Fries"],
      "assignments": [
        {
          "id": "assignment-uuid-1",
          "memberId": "member-uuid-1",
          "name": "Brother Name",
          "originalMemberName": "Brother Name",
          "status": "assigned",
          "isCovered": false,
          "coveredByName": null,
          "isFlagged": false,
          "isMakeup": false,
          "multiplier": 1
        }
      ]
    },
    "dinner": {
      "id": "slot-uuid-2",
      "meal": "dinner",
      "mealLabel": "Dinner Cleanup",
      "time": "7:30 PM – 9:00 PM",
      "dutyGroup": "Sophomores",
      "size": 3,
      "coverBounty": 1,
      "menu": ["Teriyaki Salmon", "Steamed Jasmine Rice", "Roasted Broccoli"],
      "assignments": [...]
    }
  },
  "tomorrow": {
    "date": "2026-08-25",
    "dayOfWeek": "Tuesday",
    "isToday": false,
    "menu": { ... },
    "lunch": { ... },
    "dinner": { ... }
  },
  "currentWeek": {
    "weekStart": "2026-08-24",
    "status": "posted",
    "days": [ ... 7 days ... ]
  },
  "openShifts": [
    {
      "assignmentId": "assignment-uuid-3",
      "date": "2026-08-26",
      "dayOfWeek": "Wednesday",
      "meal": "dinner",
      "originalMemberName": "Brother Name",
      "status": "flagged"
    }
  ],
  "summary": {
    "today": "Today's Duty: Lunch (Juniors): Alex, Sam | Dinner (Sophomores): Chris, Pat, Taylor",
    "tomorrow": "Tomorrow's Duty: Lunch (Juniors): Jordan, Casey | Dinner (Sophomores): Morgan, Drew, Riley",
    "openShiftsCount": 1
  }
}
```

---

## Quick-Start Client Examples for `kitchen-tv`

### 1. Standalone Single-File Web Dashboard (`index.html`)

Drop this `index.html` directly into `ZBTAA/kitchen-tv` for an instant, responsive, auto-refreshing TV display:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ZBT Kitchen TV</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --gold: #fbbf24;
      --alert: #ef4444;
      --font: system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      padding: 2rem;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #334155;
      padding-bottom: 1rem;
    }
    h1 { font-size: 2.5rem; color: var(--accent); }
    .clock { font-size: 2rem; font-weight: bold; color: var(--gold); }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin: 2rem 0;
      flex-grow: 1;
    }
    .card {
      background: var(--card-bg);
      border-radius: 1rem;
      padding: 1.5rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
    }
    .card h2 {
      font-size: 1.8rem;
      border-bottom: 1px solid #334155;
      padding-bottom: 0.5rem;
      margin-bottom: 1rem;
    }
    .meal-block {
      margin-bottom: 1.5rem;
    }
    .meal-title {
      font-size: 1.2rem;
      color: var(--accent);
      font-weight: 600;
    }
    .duty-group {
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .crew-list {
      list-style: none;
      margin-top: 0.5rem;
    }
    .crew-list li {
      font-size: 1.3rem;
      padding: 0.4rem 0.8rem;
      background: #334155;
      margin-bottom: 0.4rem;
      border-radius: 0.5rem;
    }
    .flagged { color: var(--alert); font-weight: bold; }
    footer {
      display: flex;
      justify-content: space-between;
      color: var(--text-muted);
      font-size: 1rem;
    }
  </style>
</head>
<body>

  <header>
    <h1>ZBT KITCHEN DUTY</h1>
    <div class="clock" id="clock">00:00:00 PM</div>
  </header>

  <div class="grid">
    <div class="card" id="today-card">
      <h2 id="today-header">Today's Duty</h2>
      <div id="today-content">Loading duty schedule...</div>
    </div>
    <div class="card" id="tomorrow-card">
      <h2 id="tomorrow-header">Tomorrow's Duty</h2>
      <div id="tomorrow-content">Loading duty schedule...</div>
    </div>
  </div>

  <footer>
    <span id="open-shifts">Open Shifts: 0</span>
    <span id="last-updated">Last Updated: --</span>
  </footer>

  <script>
    const API_URL = 'https://kitchen.zbtaa.online/api/tv/schedule';

    function updateClock() {
      const now = new Date();
      document.getElementById('clock').textContent = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    setInterval(updateClock, 1000);
    updateClock();

    function renderMeal(meal) {
      if (!meal) return '<p class="duty-group">No shift scheduled</p>';
      const members = meal.assignments.map(a => {
        const flagText = a.isFlagged ? ' <span class="flagged">(Flagged)</span>' : '';
        return `<li>${a.name}${flagText}</li>`;
      }).join('');

      return `
        <div class="meal-block">
          <div class="meal-title">${meal.mealLabel} (${meal.time})</div>
          <div class="duty-group">${meal.dutyGroup}</div>
          <ul class="crew-list">${members || '<li>No members assigned</li>'}</ul>
        </div>
      `;
    }

    async function fetchSchedule() {
      try {
        const res = await fetch(API_URL);
        const data = await res.json();
        if (!data.success) return;

        document.getElementById('today-header').textContent = `Today (${data.today.dayOfWeek})`;
        document.getElementById('today-content').innerHTML = 
          renderMeal(data.today.lunch) + renderMeal(data.today.dinner);

        document.getElementById('tomorrow-header').textContent = `Tomorrow (${data.tomorrow.dayOfWeek})`;
        document.getElementById('tomorrow-content').innerHTML = 
          renderMeal(data.tomorrow.lunch) + renderMeal(data.tomorrow.dinner);

        document.getElementById('open-shifts').textContent = `Open Shifts: ${data.openShifts.length}`;
        document.getElementById('last-updated').textContent = `Updated: ${new Date(data.timestamp).toLocaleTimeString()}`;
      } catch (err) {
        console.error('Failed to fetch schedule:', err);
      }
    }

    fetchSchedule();
    setInterval(fetchSchedule, 120000); // refresh every 2 minutes
  </script>
</body>
</html>
```

---

### 2. React / Next.js Custom Hook

For Eric's React/Next.js frontend setup:

```tsx
import { useState, useEffect } from 'react';

export function useKitchenTvSchedule(apiUrl = 'https://kitchen.zbtaa.online/api/tv/schedule') {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(apiUrl);
        const json = await res.json();
        if (json.success) {
          setData(json);
          setError(null);
        } else {
          setError(json.error || 'Failed to fetch schedule');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 120000); // 2 minutes
    return () => clearInterval(interval);
  }, [apiUrl]);

  return { data, loading, error };
}
```
