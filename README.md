# ZBT Kitchen Duty Tracker

Kitchen duty scheduling for the ZBT chapter house. Assigns brothers to lunch
and dinner cleanup, tracks fairness with points, and keeps a permanent record
of who was told what and when.

That record is the point. When somebody misses a shift and says they never
knew, the app answers with timestamps rather than recollection.

---

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate           # creates ./data/kitchen.db
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm test` | Full test suite (no database needed) |
| `npm run build` | Production build |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (creates the database file) |
| `npm run db:backup` | Verified snapshot into `./backups` |

Scripts that need the database take `--env-file=.env.local`:

```bash
node --env-file=.env.local --experimental-strip-types src/db/seed.ts
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_FILE` | no | Path to the SQLite file. Defaults to `./data/kitchen.db`. |
| `SESSION_SECRET` | yes | Signs session cookies. 32+ random bytes. |
| `ADMIN_PASSWORD` | yes | Kitchen manager login. Brothers use 4-digit PINs instead. |
| `CRON_SECRET` | yes in production | Protects the automated Sunday transition. Without it the endpoint refuses to run rather than sitting open. |
| `NEXT_PUBLIC_APP_URL` | for Slack | Public URL, used in Slack message links. |
| `SLACK_WEBHOOK_URL` | optional | Incoming webhook for `#kitchen-duty`. Everything works without it. |

---

## How the house rules are encoded

**Who is on duty.** Juniors serve lunch, sophomores serve dinner — fixed, not
configurable per person. Only live-ins are on the roster, decided by a numeric
room number in the contact CSV.

**Pledge class is only a default.** Brothers who rushed a year late are a year
older than the rest of their class, so duty year is a per-person field that can
be overridden at import (`--junior "Name"`) or on the roster page.

**Selection order** for any open seat:

1. Make-up debt owed (forced to the front of the queue)
2. Fewest kitchen points
3. Longest since last served
4. Seeded random

The seed is the week itself, so regenerating a week reproduces it exactly
instead of reshuffling everyone. Tie-breaking matters more than it looks: at
roughly 30 seats a week over ~94 eligible brothers, everyone's points stay
within one of each other, so the tie-break decides nearly every assignment.

**Hard constraints, never violated:** right class year for the meal, exempt
members excluded, standing weekly conflicts respected, one shift per person per
Monday–Sunday week — with make-up shifts the only exception.

**Coverage.** Anyone can cover any open shift, any class year. Only the person
who covers earns the point. The original assignee's obligation is *not* cleared;
they stay in the pool at their current total and come back up in rotation.

**Attendance is assumed.** Everyone is presumed to have shown up, and the point
is credited when they are scheduled rather than after they serve. The manager
corrects exceptions whenever he notices; a no-show takes the point back and
owes a make-up. Any shift can be set to 1x, 1.5x, 2x or 3x, and an open shift
advertises its rate publicly so somebody can take it.

---

## The weekly cadence

The house has chapter every Sunday, and the manager drives the schedule by
hand — nothing happens on a timer.

- **Create a week.** Pick a Monday; it is drawn and posted immediately. Points
  are credited to everyone on it the moment it exists.
- **Lock a week.** Closes flagging and pickups. This is what makes "you had a
  week to say something" true, so it is a deliberate switch rather than a
  scheduled job, and the manager can see plainly whether it has fallen.
- **Delete a week.** Removes it and hands back every point it issued. Refused
  once the week has begun, because people have worked shifts from it by then.

There is no draft or hidden state: a week is on the board or it does not exist.

The only scheduled job is the day-before reminder, which sends a message and
changes nothing.

---

## Importing the roster

The chapter contact export lists pledge classes and marks residency by room.

```bash
# Dry run — shows what it would do, changes nothing
node --env-file=.env.local --experimental-strip-types \
  src/db/import-roster.ts "path/to/roster.csv"

# Commit it
node --env-file=.env.local --experimental-strip-types \
  src/db/import-roster.ts "path/to/roster.csv" \
  --commit --replace \
  --exempt "Roman Ghorbani" \
  --junior "Someone Who Rushed Late"
```

Only name and class year are imported. Phone numbers and emails are
deliberately left behind — the app has no use for them, and the CSV is
gitignored so it never reaches GitHub.

`--replace` refuses to run once assignments exist, so it cannot orphan real
schedule history mid-semester.

---

## Architecture notes

- `src/lib/scheduler.ts` — pure assignment engine, no database. Fully tested.
- `src/lib/settlement.ts` — pure points arithmetic, expressed as a desired end
  state rather than an increment, which is what makes attendance corrections
  idempotent and reversible.
- `src/lib/shift-service.ts` — flag, cover, attendance, substitutes.
- `src/lib/week-admin.ts` — the manager's overrides: lock, delete, reassign.
- `src/lib/member-dossier.ts` — one brother's full record, for disputes.
- `src/db/schema.ts` — SQLite schema. The `events` table is append-only.

**Claims are conditional writes.** Two brothers tapping "pick up" at the same
instant cannot both win — the seat count is re-checked inside the statement
that inserts, so the database arbitrates rather than application code.

**Posted weeks are never regenerated.** What the house was told is the record.

### Hosting

Runs on a single DigitalOcean droplet with the database as one SQLite file on
the same disk. See [DEPLOY.md](DEPLOY.md) for setup, and `./deploy.sh` to push
changes.

SQLite rather than a hosted database because the workload is tiny — 95 people,
around 35 writes a week — and because this codebase deliberately favours
several small readable queries over one clever one. Rendering the schedule
board takes about five queries; settling a full week takes closer to two
hundred. Locally that is free. Against a network database it forces you to
write worse code to compensate.

---

## Testing

```bash
npm test    # unit tests, no database required
```

Four suites run against a real database and restore whatever they touch:

```bash
node --env-file=.env.local --experimental-strip-types scripts/smoke-points.ts
node --env-file=.env.local --experimental-strip-types scripts/smoke-covering.ts
node --env-file=.env.local --experimental-strip-types scripts/smoke-week-admin.ts
node --env-file=.env.local --experimental-strip-types scripts/smoke-cover-offer.ts
```

They cover points landing at scheduling, flag → cover → settle → no-show →
undo, the manager's overrides and their guards, and cover offers with bounties.

If member totals ever look wrong, `scripts/reconcile-points.ts` recomputes them
from the assignments, which are the authority. Dry run by default.
