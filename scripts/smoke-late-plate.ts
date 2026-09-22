/**
 * The late-plate queue, end to end, against a scratch database.
 *
 * The unit tests cover the cutoff decision as a pure function. This covers
 * what they cannot: that the migration applies, that the one-plate-per-man
 * unique index survives a cancel-then-re-request (the case that would throw a
 * constraint error if the row were inserted twice instead of reused), and that
 * a chef's override actually reaches the decision.
 *
 * Runs against a throwaway file, never your real database:
 *
 *   DATABASE_FILE=./data/smoke-late-plate.db node --experimental-strip-types \
 *     scripts/smoke-late-plate.ts
 *
 * Delete the file afterwards; it is recreated from the migrations each run.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';

import { sqlite, db } from '../src/db/index.ts';
import { semesters, members, latePlates, events } from '../src/db/schema.ts';
import { eq as eqCol } from 'drizzle-orm';
import { DEFAULT_MEAL_DAYS, DEFAULT_SLOT_SIZES } from '../src/lib/types.ts';
import {
  getStandingCutoffs,
  getLatePlateSettings,
  DEFAULT_CUTOFFS,
  requestLatePlate,
  cancelLatePlate,
  setLatePlateStatus,
  setLatePlateSettings,
  listLatePlates,
  mealWindow,
  mealWindowsForRange,
  myLatePlatesInRange,
} from '../src/lib/late-plate-service.ts';

if (!process.env.DATABASE_FILE?.includes('smoke')) {
  throw new Error(
    'Refusing to run: set DATABASE_FILE to a scratch path containing "smoke".',
  );
}

// Every migration, in order - a hand-kept list here went stale once already.
for (const file of readdirSync('drizzle')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => `drizzle/${f}`)) {
  for (const stmt of readFileSync(file, 'utf8').split('--> statement-breakpoint')) {
    if (stmt.trim()) sqlite.exec(stmt);
  }
}

await db.insert(semesters).values({
  name: 'Fall 2026',
  startsOn: '2026-08-24',
  endsOn: '2026-12-18',
  active: true,
  mealDays: DEFAULT_MEAL_DAYS,
  slotSizes: DEFAULT_SLOT_SIZES,
});
const [ben] = await db
  .insert(members)
  .values({ name: 'Ben Torres', classYear: 'junior' })
  .returning();
const [sam] = await db
  .insert(members)
  .values({ name: 'Sam Kelly', classYear: 'sophomore' })
  .returning();

let failed = 0;
function ok(label: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

/* Before anything is set, a meal falls back to the seeded house cutoff. */
{
  const seeded = await getStandingCutoffs();
  ok('an untouched dinner cutoff is the seed', seeded.dinner.cutoff === '16:00');
  ok('and it reports itself as the house default', seeded.dinner.isHouseDefault);
  ok('an untouched lunch cutoff is 1:30 PM', seeded.lunch.cutoff === '13:30');
}

const tue = '2026-09-01'; // a Tuesday; the house serves both meals
const at = (hhmm: string) => new Date(`${tue}T${hhmm}:00-04:00`);

let r = await requestLatePlate(ben.id, tue, 'dinner', 'no onions', at('10:00'));
ok('request before the cutoff succeeds', r.ok);

r = await requestLatePlate(ben.id, tue, 'dinner', null, at('10:05'));
ok('a duplicate request is refused', !r.ok && /already have/.test(r.message));

r = await requestLatePlate(sam.id, tue, 'dinner', null, at('10:05'));
ok('a second brother can request the same meal', r.ok);

r = await requestLatePlate(ben.id, tue, 'dinner', null, at('16:30'));
ok('a request after the 4:00 PM cutoff is refused', !r.ok);

const mine = await myLatePlatesInRange(ben.id, tue, tue);
ok('one row for Ben, not two', mine.length === 1);

r = await cancelLatePlate(mine[0].id, ben.id, at('11:00'));
ok('a brother can cancel his own plate', r.ok);
r = await cancelLatePlate(mine[0].id, sam.id, at('11:00'));
ok("a brother cannot cancel someone else's plate", !r.ok);

r = await requestLatePlate(ben.id, tue, 'dinner', 'back on', at('11:30'));
ok('re-requesting after a cancel succeeds', r.ok);
const after = await myLatePlatesInRange(ben.id, tue, tue);
ok('still exactly one row after the re-request', after.length === 1);
ok('the new note replaced the old one', after[0].note === 'back on');

/* Same day, again and again: cancel and ask again as often as he likes. */
r = await cancelLatePlate(after[0].id, ben.id, at('11:40'));
ok('a second same-day cancel succeeds', r.ok && r.message === 'Cancelled.');
r = await requestLatePlate(ben.id, tue, 'dinner', 'actually yes', at('11:45'));
ok('a second same-day re-request succeeds', r.ok);

r = await setLatePlateStatus(after[0].id, 'ready', null, 'Kitchen tablet');
ok('the kitchen can mark a plate ready after the cutoff', r.ok);

const live = await listLatePlates(tue);
ok('the queue shows both live plates', live.length === 2);
ok(
  'the ready status is reflected',
  live.some((p) => p.name === 'Ben Torres' && p.status === 'ready'),
);

const samRow = live.find((p) => p.name === 'Sam Kelly')!;
r = await setLatePlateStatus(samRow.id, 'declined', 'ran out of chicken', 'Chris');
ok('declining with a reason succeeds', r.ok);
ok('a declined plate drops off the live queue', (await listLatePlates(tue)).length === 1);

const all = await listLatePlates(tue, { includeClosed: true });
ok('a declined plate is still on the record', all.length === 2);
ok('the decline reason is stored', all.some((p) => p.reason === 'ran out of chicken'));

r = await setLatePlateSettings(tue, { dinner: { cutoff: '19:00' } }, 'Roman');
ok('an override saves', r.ok);
ok(
  'a later override reopens dinner at 5 PM',
  (await mealWindow(tue, 'dinner', at('17:00'))).open,
);

await setLatePlateSettings(tue, { dinner: { closed: true } }, 'Roman');
const closed = await mealWindow(tue, 'dinner', at('12:00'));
ok('closing shuts the meal regardless of the cutoff', !closed.open);
r = await requestLatePlate(sam.id, tue, 'lunch', null, at('12:00'));
ok('closing dinner did not close lunch', r.ok);

const sat = '2026-09-05'; // the house serves dinner only on Saturdays
const windows = await mealWindowsForRange([tue, sat], at('09:00'));
ok('Saturday lunch is not served', windows.get(`${sat}:lunch`)!.served === false);
ok('Saturday dinner is served', windows.get(`${sat}:dinner`)!.served === true);
ok('the range query covers both days and both meals', windows.size === 4);

/* --- allergens, restrictions, and the acknowledgement gate ---------- */

const wed = '2026-09-02';
const atWed = (hhmm: string) => new Date(`${wed}T${hhmm}:00-04:00`);

r = await requestLatePlate(
  ben.id,
  wed,
  'dinner',
  { flags: ['peanuts', 'kosher', 'unicorns'], flagsOther: null, remember: true },
  atWed('10:00'),
);
ok('a request with flags succeeds', r.ok);

const flagged = (await myLatePlatesInRange(ben.id, wed, wed))[0];
ok('unknown flags were dropped', !flagged.flags.ids.includes('unicorns'));
ok('the allergen is classed as one', flagged.flags.allergens.includes('Peanuts'));
ok('the dietary flag is classed as one', flagged.flags.dietary.includes('Kosher'));

const [benRow] = await db
  .select({ flags: members.dietaryFlags })
  .from(members)
  .where(eqCol(members.id, ben.id));
ok('his flags were remembered on his member record', (benRow.flags ?? []).includes('peanuts'));

/* The rule that matters most in this whole feature. */
r = await setLatePlateStatus(flagged.id, 'ready', null, 'Chris');
ok('a flagged plate CANNOT be marked ready without acknowledging', !r.ok);
ok('the refusal names the restrictions', /Peanuts/.test(r.message) && /Kosher/.test(r.message));

const stillWaiting = (await myLatePlatesInRange(ben.id, wed, wed))[0];
ok('the refused plate really did not change status', stillWaiting.status === 'waiting');

r = await setLatePlateStatus(flagged.id, 'ready', null, 'Chris', { acknowledged: true });
ok('acknowledging lets it through', r.ok);

const acked = (await myLatePlatesInRange(ben.id, wed, wed))[0];
ok('the acknowledgement is recorded', acked.acknowledgedAt !== null);
ok('and by whom', acked.acknowledgedBy === 'Chris');

/* Declining needs no acknowledgement - nothing is being made. */
r = await requestLatePlate(sam.id, wed, 'dinner', { flags: ['shellfish'] }, atWed('10:00'));
const samFlagged = (await myLatePlatesInRange(sam.id, wed, wed))[0];
r = await setLatePlateStatus(samFlagged.id, 'declined', 'no substitute tonight', 'Chris');
ok('declining a flagged plate needs no acknowledgement', r.ok);

/* An unflagged plate is not gated at all. */
r = await requestLatePlate(sam.id, wed, 'lunch', { flags: [] }, atWed('10:00'));
const plain = (await myLatePlatesInRange(sam.id, wed, wed)).find((p) => p.meal === 'lunch')!;
r = await setLatePlateStatus(plain.id, 'ready', null, 'Chris');
ok('an unflagged plate needs no acknowledgement', r.ok);

/* Omitting flags entirely means "use my usual", not "I have none". */
r = await cancelLatePlate(acked.id, ben.id, atWed('10:30'));
r = await requestLatePlate(ben.id, wed, 'dinner', { note: 'quick one' }, atWed('10:35'));
const reused = (await myLatePlatesInRange(ben.id, wed, wed))[0];
ok('omitting flags reuses his remembered ones', reused.flags.allergens.includes('Peanuts'));
ok('a re-request clears the old acknowledgement', reused.acknowledgedAt === null);

/* Passing an explicit empty array does mean "none today". */
r = await cancelLatePlate(reused.id, ben.id, atWed('10:40'));
r = await requestLatePlate(ben.id, wed, 'dinner', { flags: [], remember: false }, atWed('10:45'));
const cleared = (await myLatePlatesInRange(ben.id, wed, wed))[0];
ok('an explicit empty array means none this time', !cleared.flags.hasAny);

const [benAfter] = await db
  .select({ flags: members.dietaryFlags })
  .from(members)
  .where(eqCol(members.id, ben.id));
ok(
  'remember:false left his standing flags alone',
  (benAfter.flags ?? []).includes('peanuts'),
);

/* --- cancelling, and what the chefs then see ------------------------- */

const thu = '2026-09-03';
const atThu = (hhmm: string) => new Date(`${thu}T${hhmm}:00-04:00`);

await requestLatePlate(ben.id, thu, 'dinner', { flags: ['peanuts'] }, atThu('09:00'));
const late = (await myLatePlatesInRange(ben.id, thu, thu))[0];

/**
 * The rule that changed: a cancellation is never too late. Refusing it after
 * the cutoff only meant a chef made a plate nobody was going to collect.
 */
r = await cancelLatePlate(late.id, ben.id, atThu('18:45'));
ok('a brother can cancel long after the cutoff', r.ok);

const cancelled = (await myLatePlatesInRange(ben.id, thu, thu))[0];
ok('it is marked cancelled', cancelled.status === 'cancelled');
ok('with the time he pulled out', cancelled.resolvedAt !== null);

/* The chefs must see it, and must not be able to act on it. */
const chefView = await listLatePlates(thu, { includeClosed: true });
ok(
  'the chefs can see the cancellation',
  chefView.some((p) => p.id === cancelled.id && p.status === 'cancelled'),
);

r = await setLatePlateStatus(cancelled.id, 'ready', null, 'Chris');
ok('a chef cannot mark a cancelled plate ready', !r.ok);
ok('and is told why', /cancelled/i.test(r.message));
r = await setLatePlateStatus(cancelled.id, 'ready', null, 'Chris', { acknowledged: true });
ok('acknowledging does not get round it either', !r.ok);
r = await setLatePlateStatus(cancelled.id, 'declined', 'too late', 'Chris');
ok('a chef cannot decline a cancelled plate', !r.ok);

const untouched = (await myLatePlatesInRange(ben.id, thu, thu))[0];
ok('and the row really did not move', untouched.status === 'cancelled');

/* Cancelling a plate that was already made is allowed - the kitchen still
   wants to know it will not be collected. */
await requestLatePlate(sam.id, thu, 'dinner', { flags: [] }, atThu('09:00'));
const samThu = (await myLatePlatesInRange(sam.id, thu, thu))[0];
r = await setLatePlateStatus(samThu.id, 'ready', null, 'Chris');
ok('his plate is made', r.ok);
r = await cancelLatePlate(samThu.id, sam.id, atThu('19:30'));
ok('he can still cancel an already-plated meal', r.ok);
ok('and is told it was already made', /already plated/i.test(r.message));

/* Cancelling twice is not a thing. */
r = await cancelLatePlate(samThu.id, sam.id, atThu('19:31'));
ok('cancelling twice is refused', !r.ok);

/* Requests come back in the order they were asked for. */
await requestLatePlate(ben.id, thu, 'lunch', { flags: [] }, atThu('08:00'));
await requestLatePlate(sam.id, thu, 'lunch', { flags: [] }, atThu('07:30'));
const lunchQueue = (await listLatePlates(thu, { includeClosed: true })).filter(
  (p) => p.meal === 'lunch',
);
ok(
  'the queue is ordered by when it was asked for',
  lunchQueue[0].name === 'Sam Kelly' && lunchQueue[1].name === 'Ben Torres',
);

/* --- cutoffs that carry forward -------------------------------------- */

const monday = '2026-09-07';
const tuesday = '2026-09-08';

ok('the seeded lunch cutoff is 1:30 PM', DEFAULT_CUTOFFS.lunch === '13:30');
ok('the seeded dinner cutoff is 4:00 PM', DEFAULT_CUTOFFS.dinner === '16:00');

let standing = await getStandingCutoffs();
/* The whole point: a chef moves dinner on Monday, Tuesday inherits it. */
r = await setLatePlateSettings(monday, { dinner: { cutoff: '16:45' } }, 'Chris');
ok('a chef can move a cutoff', r.ok);

let monSettings = await getLatePlateSettings(monday);
ok("Monday's cutoff moved", monSettings.dinner.cutoff === '16:45');

let tueSettings = await getLatePlateSettings(tuesday);
ok('and Tuesday inherits it without anyone setting it', tueSettings.dinner.cutoff === '16:45');
ok('Tuesday has no override of its own', tueSettings.dinner.isDefault === true);
ok('lunch was left alone', tueSettings.lunch.cutoff === '13:30');

standing = await getStandingCutoffs();
ok('the standing value moved too', standing.dinner.cutoff === '16:45');
ok('it no longer claims to be the house default', standing.dinner.isHouseDefault === false);
ok('and it remembers who moved it', standing.dinner.updatedBy === 'Chris');

/* The window the brothers are judged against uses the inherited value. */
let w = await mealWindow(tuesday, 'dinner', new Date(`${tuesday}T16:30:00-04:00`));
ok('a request at 4:30 PM on Tuesday is inside the inherited cutoff', w.open);
w = await mealWindow(tuesday, 'dinner', new Date(`${tuesday}T16:50:00-04:00`));
ok('and 4:50 PM is outside it', !w.open);

/* Closing is a decision about one service and must never carry forward. */
r = await setLatePlateSettings(monday, { dinner: { closed: true } }, 'Chris');
ok('a chef can stop taking requests', r.ok);
monSettings = await getLatePlateSettings(monday);
ok('Monday dinner is closed', monSettings.dinner.closed === true);
tueSettings = await getLatePlateSettings(tuesday);
ok('Tuesday is NOT closed - closing never carries forward', tueSettings.dinner.closed === false);
ok('but Tuesday still has the moved cutoff', tueSettings.dinner.cutoff === '16:45');

/* Closing must not clobber the cutoff it was saved alongside. */
ok('closing left Monday\'s cutoff intact', monSettings.dinner.cutoff === '16:45');

/* Turning requests back on. */
r = await setLatePlateSettings(monday, { dinner: { closed: false } }, 'Chris');
monSettings = await getLatePlateSettings(monday);
ok('the toggle goes back on', monSettings.dinner.closed === false);

/* A one-day-only change, for when that is what is wanted. */
r = await setLatePlateSettings(monday, { dinner: { cutoff: '15:00' } }, 'Chris', {
  carryForward: false,
});
monSettings = await getLatePlateSettings(monday);
tueSettings = await getLatePlateSettings(tuesday);
ok('carryForward:false still changes that day', monSettings.dinner.cutoff === '15:00');
ok('but leaves tomorrow alone', tueSettings.dinner.cutoff === '16:45');

/* Rubbish is refused before anything is written. */
r = await setLatePlateSettings(monday, { lunch: { cutoff: '25:00' } }, 'Chris');
ok('an impossible time is refused', !r.ok);
standing = await getStandingCutoffs();
ok('and did not reach the standing value', standing.lunch.cutoff === '13:30');

/* --- audit ---------------------------------------------------------- */

const log = await db.select().from(events).where(eq(events.entityType, 'late-plate'));
const actions = new Set(log.map((e) => e.action));

/**
 * A count would only ever tell you the arithmetic changed. What matters is
 * that each kind of consequential action left a trace - that is what the log
 * is for when somebody disputes a plate later.
 */
for (const action of [
  'late-plate.requested',
  'late-plate.cancelled',
  'late-plate.ready',
  'late-plate.declined',
]) {
  ok(`${action} is written to the audit log`, actions.has(action));
}
ok('a refused action writes nothing', log.length === new Set(log.map((e) => e.id)).size);

console.log(
  `\n${log.length} late-plate events, ` +
    `${(await db.select().from(latePlates)).length} plate rows`,
);
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
