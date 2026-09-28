# HTTP API

Everything the UI does goes through server actions; these JSON endpoints exist
for the kitchen tablet, the house display, calendar apps and the reminder
timer. All responses are `Cache-Control: no-store`. None send CORS headers -
every browser caller is same-origin and the display calls server to server.

## Who can call what

| Endpoint | Brother | Manager | Paired tablet | Display key | Other |
|---|---|---|---|---|---|
| `GET /api/late-plates` | ✓ | ✓ | ✓ | | |
| `POST /api/late-plates` | ✓ (as himself) | | | | |
| `PATCH /api/late-plates/:id` | | ✓ | ✓ | | |
| `GET/PUT /api/late-plates/settings` | read | ✓ | ✓ | | |
| `GET/PUT /api/menu` | read | ✓ | ✓ | | |
| `GET /api/tv/schedule` | | ✓ | | ✓ | |
| `GET /api/tv/late-plates` | | ✓ | | ✓ | |
| `GET /api/calendar/<feed token>.ics` | | | | | signed link |
| `GET /api/cron/reminder` | | | | | `Authorization: Bearer $CRON_SECRET` |
| `GET /api/health` | | | | | anyone - returns `{ ok }` only |

- **Brother / manager**: the `zbt_session` cookie, verified and checked for
  revocation on every request.
- **Paired tablet**: the `zbt_kiosk` cookie from `/kitchen/pair`.
- **Display key**: `X-API-Key: $TV_API_KEY` or `Authorization: Bearer $TV_API_KEY`.
  Query-string keys are not accepted. Unset means nothing is accepted.

Unauthorized requests get `401 { "error": "Unauthorized" }`.

## `GET /api/tv/schedule`

What the dining room display shows: today's and tomorrow's crews and menus,
this week and next, open shifts. Names only.

```json
{
  "success": true, "timestamp": "...", "timezone": "America/New_York",
  "pollIntervalSeconds": 120,
  "semester": { "id": "...", "name": "Fall 2026" },
  "today": {
    "date": "2026-09-28", "dayOfWeek": "Monday", "isToday": true,
    "lunch":  { "meal": "lunch", "time": "2:30 PM – 3:00 PM", "dutyGroup": "Juniors",
                "size": 2, "coverBounty": 1, "assignments": [ { "name": "...", "isFlagged": false, "isMakeup": false } ],
                "menu": ["..."] },
    "dinner": { "...": "..." },
    "menu": { "hasMenu": true, "lunch": ["..."], "dinner": ["..."] }
  },
  "tomorrow": { "...": "..." },
  "currentWeek": { "weekStart": "2026-09-28", "status": "posted", "days": [] },
  "nextWeek": null,
  "openShifts": [ { "date": "...", "meal": "dinner", "originalMemberName": "...", "status": "flagged" } ],
  "summary": { "today": "...", "tomorrow": "...", "openShiftsCount": 1 }
}
```

Open seats on a slot are `size - assignments.length`.

## `GET /api/tv/late-plates`

```json
{
  "success": true, "date": "2026-09-28", "currentMeal": "dinner",
  "meals": {
    "dinner": { "cutoff": "4:00 PM", "open": true, "served": true, "closed": false, "toMake": 3, "ready": 2 }
  },
  "plates": [ { "name": "...", "meal": "dinner", "status": "waiting" } ]
}
```

Deliberately nothing else: no notes, allergens or ids reach the wall.

## Late plates and menus

The request, status and settings endpoints, their payloads and the cutoff
rules are documented in [LATE_PLATE.md](LATE_PLATE.md#api).

`GET /api/menu?date=YYYY-MM-DD|today|tomorrow` returns one day;
`GET /api/menu?startDate=YYYY-MM-DD&days=N` (1-35) a range.
`PUT /api/menu` takes `{ date, lunch: string[], dinner: string[] }` or
`{ menus: { "<date>": { lunch, dinner } } }`. A day with both meals empty is
removed.

## Calendar feed

Brothers subscribe from Home. The URL is
`/api/calendar/<member id>.<HMAC>.ics`; the signature is derived from
`SESSION_SECRET`, so rotating that secret invalidates every subscription.

## Reminder

`GET /api/cron/reminder` with `Authorization: Bearer $CRON_SECRET` posts
tomorrow's crews to Slack (if `SLACK_WEBHOOK_URL` is set). Called daily at
7 PM by `kitchen-portal-reminder.timer`. Refuses to run if `CRON_SECRET` is
unset.
