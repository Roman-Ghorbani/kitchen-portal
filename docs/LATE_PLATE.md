# Late plates

Brothers ask for a plate on the site instead of writing their name on a box on
the chefs' cart. The pieces: the brother-facing Menu tab (`/late-plate`),
allergen and dietary flagging with a mandatory chef acknowledgement, the chef
screen on a paired kitchen tablet (`/kitchen/late-plates`), the manager's view
under Late plates, and a names-only panel on the dining room display.

## How it behaves

- Any signed-in brother can request one plate per meal per day, up to seven
  days ahead. `memberId` always comes from his session — there is no way to put
  someone else's name in the queue.
- **The cutoff is enforced on the server**, on the house wall clock read
  through `Intl` rather than the server's own timezone. A cutoff checked only in
  the browser is not a cutoff.
- Nothing is deleted. A cancelled or declined request keeps its row and changes
  status, so the chefs can tell "he pulled out" from "it vanished".
- Cancelling is never blocked by the cutoff. See **Cancellations** below.
- Every action writes an `events` row, same as the rest of the app.
- **A flagged plate cannot be marked ready without an acknowledgement.** See
  below.

## Allergens and dietary restrictions

The catalogue lives in `src/lib/dietary.ts` — one list, used by the request
form, the chef screen, the API and the log. Ids are stored, labels are only ever
rendered, so renaming a label never orphans a stored flag or rewrites what a
past request said.

**Allergens**: peanuts, tree nuts, milk/dairy, egg (not baked), fish, shellfish,
soy, sesame, wheat, gluten-free. That is the FDA's nine major allergens plus
gluten — sesame is on it because it became the ninth in 2023 and is the one most
often missing from lists copied off older sources.

**Dietary and religious**: kosher, kosher for Passover, Lent, Ramadan, no beef
(Hindu), and Other with free text.

The two are separated by `kind` and the chef screens lead with the allergens,
because they are not the same class of problem: getting Lent wrong is an
apology, getting peanuts wrong is an ambulance.

Adding a flag is one entry in that array — no migration, since ids are stored as
JSON. **Halal is not on the list.** It was left off deliberately after the
options round; add it if the chefs ask, it is a one-line change.

### How the flags travel

- A brother's flags are remembered on his member record and come **pre-ticked**
  next time. The tick he has to remember is the tick he forgets.
- Each request stores a **snapshot**, not a join. If he drops an allergy in
  October, the plate made in September still says what the kitchen was told at
  the time — the only version worth having in a record anybody might argue about.
- Omitting `flags` from a POST means *use my usual*, not *I have none*. An
  explicit `[]` means none this time. The silent version of the second is how an
  allergy goes missing.
- Free text typed without ticking "Other" still reaches the kitchen.
- Re-requesting after a cancel clears any previous acknowledgement — a chef
  acknowledged the flags as they stood then, not these.

### The acknowledgement

Pressing **Ready** on a flagged plate opens a dialog listing the allergies and
restrictions; the chef confirms before it goes through. That dialog is not the
guard — the server is. `setLatePlateStatus` refuses `ready` on a flagged plate
without `acknowledged: true` and names the flags in the 409, so a tablet running
last month's JavaScript, a mis-tap, or curl all hit the same wall.

Declining needs no acknowledgement (nothing is being made). Unflagged plates are
not gated at all — one tap, as before.

Who acknowledged and when is stored on the row and written to the audit log.

## The chef screen

`/kitchen/late-plates` — no PIN, no sidebar. The tablet is **paired** once:
the manager presses *Pair a tablet* on the Late plates page, and a short code
typed at `/kitchen/pair` gives the tablet an httpOnly cookie it keeps for good.
Anything the chefs have to log into, they will stop using; this asks nothing
of them after day one. The manager can open the same screen from his session
(*Open kiosk view*) to see exactly what they see.

**One meal at a time.** Only lunch or dinner is ever out and being served, so
the screen shows one meal and opens on whichever is current. The other is one
tap away and its outstanding count is always on screen — in red when it has
work — so nothing hides behind the toggle.

The handover is **2:30 PM**, the end of lunch service, not the 1:00 PM request
cutoff. Plates asked for before the cutoff are still being made and collected
after it, and flipping the screen away mid-service is exactly when one gets
forgotten. Constant: `MEAL_HANDOVER`.

**Still to make** sits at the top at full size, ordered by when it was asked
for. **Handled** — ready, declined, cancelled — collapses into a quieter
section below: present, because a chef needs to check lunch is finished before
starting dinner, but never competing with work that is still outstanding.

An empty queue says so plainly, and distinguishes *nobody asked* from *all
done, here is what you handled*.

**Meal controls** sit at the top of whichever meal is showing:

- **Taking requests** — a switch writing `closed` for that meal, that day. Off,
  brothers can't ask for that meal and the screen says the cutoff comes back
  tomorrow on its own. Requests already in the queue are untouched: closing
  stops new ones, it doesn't cancel what was promised.
- **Cutoff time** — tappable, opens a stepper that moves in 15-minute taps and
  says plainly that saving changes the cutoff *from now on, not just today*.

Neither is optimistic: both change what brothers can do, so the screen re-reads
from the server rather than showing what was tapped.

**Declining** is one tap. Three reasons — *Kitchen closed for the night*, *Ran
out of food*, *Missed the cutoff time* — decline immediately, with a free-text
box for anything else and *Never mind* to back out. A reason then a confirm is
two taps for a decision already made.

Other details:

- Polls `GET /api/late-plates?all=1`, the same endpoint every other client
  uses, so this screen is proof the API works rather than a private path.
- Sized for a greasy finger: nothing tappable under 44px, type larger than
  anywhere else in the app because it is read across a counter.
- Allergen plates carry a red rail and an ALLERGY badge.
- Every card shows the time it was asked.
- The pairing cookie is renewed on every load, so a tablet that is used daily
  never has to be paired again. A tablet still on the old `?device=` bookmark
  converts itself into a paired device on its next load.

### Cancellations

A brother can cancel at any time, and the chefs see it.

- **The cutoff does not apply to cancelling.** It exists to stop new work
  arriving late; a cancellation removes work, and the later it comes the more
  useful it is. Refusing it at four o'clock only meant a chef made a plate
  nobody was going to collect.
- Cancelling an already-plated meal is allowed too. It does not un-make it, but
  the kitchen still wants to know it will not be picked up — the brother is told
  as much.
- The chef screen shows a cancelled plate in Handled, marked
  *"Cancelled by Marcus at 4:42 PM — do not make this"*, with **no action
  buttons at all**.
- The server refuses `ready` and `declined` on a cancelled plate regardless of
  acknowledgement. The greyed-out card is the screen agreeing with the rule, not
  enforcing it.


## The day's menu

The Menu tab shows what is actually being served. The chefs enter menus on the
tablet's *Menu* view; they are stored one row per date in the `menus` table.
The same menus appear on the Senior Week page (`/menu`) and, through
`/api/tv/schedule`, on the dining room display.

## Cutoffs

A cutoff resolves in three steps, in this order:

1. an override the chefs set for that specific day
2. the **standing** cutoff — whatever they last saved for that meal
3. the house default: **lunch 1:30 PM, dinner 4:00 PM**

Step 2 is what makes their changes stick. Move dinner to 4:30 on a Tuesday and
Wednesday opens at 4:30 too, without anyone setting it again. Step 3 is only
ever reached on a database where no cutoff has ever been saved.

Standing values live in `late_plate_meal_defaults`, one row per meal, with who
moved it and when. A stored value that fails to parse falls back to the house
default rather than being handed on — `decideWindow` fails closed on an
unparseable cutoff, and one typo should not shut a meal every day until somebody
notices.

**Closing a meal never carries forward.** "Taking requests" off is a decision
about one service — *kitchen closed for the night* — and inheriting it would
silently refuse tomorrow's requests, which is the kind of failure nobody thinks
to look for. The per-day row holds it; nothing else does.

`PUT /api/late-plates/settings` carries a cutoff forward by default. Pass
`carryForward: false` to move one for a single day.

## Setting it up

1. `npm run db:migrate`.
2. On the Late plates page, pair the kitchen tablet.
3. Set which days take requests, and a banner if there is anything to say.

## API

The app is on a public hostname, so every endpoint is gated:

| Who | Read the queue | Change a plate / the settings |
| --- | --- | --- |
| Signed out | no | no |
| Brother (PIN session) | yes | no |
| Kitchen manager | yes | yes |
| Paired kitchen tablet | yes | yes |

The dining room display does not use these endpoints. It reads
`/api/tv/late-plates` with its own read-only key, and gets names and statuses
only — never notes or dietary flags. See [API.md](API.md).

### `GET /api/late-plates?date=YYYY-MM-DD`

Defaults to today. `&all=1` includes cancelled and declined rows. Same
envelope as `/api/tv/schedule` — `success`, `timestamp`, `timezone`,
`pollIntervalSeconds`.

```json
{
  "success": true,
  "date": "2026-09-01",
  "dayOfWeek": "Tuesday",
  "isToday": true,
  "pollIntervalSeconds": 20,
  "meals": {
    "dinner": {
      "serves": "4:30 PM", "cutoff": "4:00 PM", "cutoff24": "16:00",
      "usingDefaultCutoff": true, "closed": false, "served": true,
      "open": true, "closedReason": null, "waiting": 2, "ready": 1
    }
  },
  "latePlates": [
    { "id": "…", "name": "Ben Torres", "meal": "dinner", "status": "waiting",
      "note": "no onions", "reason": null, "requestedAt": "…",
      "allergens": ["Peanuts"], "dietary": ["Kosher"],
      "restrictions": ["Peanuts", "Kosher"], "hasAllergen": true,
      "needsAcknowledgement": true,
      "acknowledgedAt": null, "acknowledgedBy": null,
      "cancelledAt": null }
  ]
}
```

Flags come out as **labels, not ids**, so a display never has to carry the
catalogue. `cancelledAt` is set only on cancelled rows, so a chef screen never
has to work out which timestamp means what.

`meals.<meal>` carries `toMake` (the only number the kitchen acts on),
`ready`, `declined`, `cancelled`, `handled` and `flagged`. Counts are always
computed from the whole day even when the list is filtered — counts from a
pre-filtered list would report zero cancellations to any caller that did not ask
for them, which is how a screen ends up quietly disagreeing with itself.
`currentMeal` at the top level is which meal the kitchen is on right now.

### `POST /api/late-plates`

Brother session only.

```json
{ "meal": "dinner", "date": "2026-09-01", "note": "…",
  "flags": ["peanuts", "kosher"], "flagsOther": "no cilantro", "remember": true }
```

`date` defaults to today and `memberId` is ignored if sent. Omitting `flags`
uses his standing ones; `remember: true` makes what he sent his new standing
set. 201 on success, 409 when the cutoff has passed or he already has one down.

### `PATCH /api/late-plates/:id`

Manager or paired tablet.

```json
{ "status": "ready", "acknowledged": true }
{ "status": "declined", "reason": "ran out of chicken" }
```

No cutoff check — the cutoff governs what brothers may add, not what the kitchen
may do about what is in front of it. `acknowledged: true` is **required** to
mark a flagged plate ready; without it you get a 409 naming the flags.

### `GET` / `PUT /api/late-plates/settings`

Manager or paired tablet for the `PUT`.

```json
{ "date": "2026-09-01", "dinner": { "cutoff": "16:45", "closed": false },
  "carryForward": true }
```

A cutoff saved here becomes the standing value unless `carryForward` is false;
`closed` never does. The `GET` returns `settings` (what's in force on that date),
`standing` (what tomorrow will use, with who last moved it), and `houseDefaults`
(the seeds). A day nobody has touched stores no rows at all.

## Testing

```
npm test        # cutoffs, the flag catalogue, menus, who-may-do-what
DATABASE_FILE=/tmp/smoke-late-plate.db \
  node --experimental-strip-types scripts/smoke-late-plate.ts
```

The smoke script builds a throwaway database from the migrations and refuses to
run unless `DATABASE_FILE` names a path containing "smoke".

## Still open

- **Halal is not in the flag list.** Ramadan is. One line to add.
- **The decline reasons** came from the mockup; replace them with the chefs'
  own words.
- **The box still needs a name on it.** Sign-up moved online; labelling the
  physical box did not. Plate numbers ("7" instead of a name) would be a column
  and a display change.
- Nothing notifies a brother when his plate is marked ready. Deliberate for v1.
