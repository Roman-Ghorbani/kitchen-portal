/**
 * Turns the roster in the database into a persisted week of assignments.
 *
 * Generation is server-side only and deliberately one-directional: a week is
 * generated once, and once it is posted it is never regenerated in place. What
 * the house was told is the record, so overwriting it would destroy the thing
 * the app exists to provide.
 */

import { eq, and, inArray, asc, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import {
  members as membersTable,
  standingConflicts,
  semesters,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../db/schema.ts';
import { generateWeek, type ScheduleResult } from './scheduler.ts';
import {
  type Member,
  type Meal,
  type MealDayConfig,
  type DayIndex,
} from './types.ts';
import { weekDates, chapterLockFor, addDays } from './dates.ts';

/* ------------------------------------------------------------------ */
/* Reading the roster                                                  */
/* ------------------------------------------------------------------ */

export async function loadSchedulingRoster(semesterId: string): Promise<Member[]> {
  const rows = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.active, true))
    .orderBy(asc(membersTable.name));

  const conflicts = await db
    .select()
    .from(standingConflicts)
    .where(eq(standingConflicts.semesterId, semesterId));

  const byMember = new Map<string, DayIndex[]>();
  const today = new Date().toISOString().slice(0, 10);

  for (const c of conflicts) {
    // A temporary block stops applying once it expires.
    if (c.scope === 'temporary' && c.expiresOn && c.expiresOn < today) continue;
    const list = byMember.get(c.memberId) ?? [];
    list.push(c.dayIndex as DayIndex);
    byMember.set(c.memberId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    classYear: r.classYear,
    points: r.points,
    exempt: r.exempt,
    exemptReason: r.exemptReason ?? undefined,
    exemptNotes: r.exemptNotes ?? undefined,
    standingConflicts: byMember.get(r.id) ?? [],
    lastServedDate: r.lastServedDate,
    makeupDebt: r.makeupDebt,
  }));
}

export async function getActiveSemester() {
  const [row] = await db
    .select()
    .from(semesters)
    .where(eq(semesters.active, true))
    .limit(1);
  if (!row) throw new Error('No active semester. Run the seed script first.');
  return row;
}

/* ------------------------------------------------------------------ */
/* Generating and persisting                                           */
/* ------------------------------------------------------------------ */

export interface GenerateOptions {
  /**
   * Unused. Kept so existing callers compile; a generated week is always on
   * the board. There is no hidden state - a week either exists or it does not.
   */
  post?: boolean;
  /**
   * True only for the first week of a semester, which cannot get the normal
   * full 7-day flag window because the semester starts right after chapter.
   */
  isBootstrap?: boolean;
  /** Overrides the lock deadline; defaults to the chapter before the week. */
  locksAt?: Date;
}

/**
 * Credits the point for every assignment in a freshly generated week.
 *
 * Being on the schedule is what earns the point. Attendance is assumed, and
 * the point is taken back only if somebody actually fails to serve - so the
 * credit lands the moment the week is drawn, not after the day has passed.
 *
 * This is not cosmetic. The scheduler picks by fewest points, so if credit
 * lagged behind scheduling, a second week drawn before the first one ran
 * would see an all-zero pool and could pick the same people again. Points
 * have to reflect what somebody has been asked to do, not only what has
 * already happened.
 *
 * Done as two statements rather than a settle call per row: generation writes
 * thirty assignments at once, and thirty sequential round trips to a remote
 * database is a slow way to do arithmetic.
 */
async function creditNewAssignments(weekId: string): Promise<void> {
  await db.execute(sql`
    UPDATE assignments a
    SET points_awarded = a.multiplier,
        settled_recipient_id = a.member_id,
        settled_at = now()
    FROM slots s
    WHERE s.id = a.slot_id AND s.week_id = ${weekId}
  `);

  await db.execute(sql`
    UPDATE members m
    SET points = m.points + agg.pts,
        last_served_date = GREATEST(
          COALESCE(m.last_served_date, DATE '1970-01-01'),
          agg.latest
        )
    FROM (
      SELECT a.member_id, SUM(a.multiplier)::int AS pts, MAX(s.date) AS latest
      FROM assignments a
      JOIN slots s ON s.id = a.slot_id
      WHERE s.week_id = ${weekId}
      GROUP BY a.member_id
    ) agg
    WHERE m.id = agg.member_id
  `);
}

export async function generateAndSaveWeek(
  weekStart: string,
  options: GenerateOptions = {},
) {
  const semester = await getActiveSemester();

  const existing = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.semesterId, semester.id), eq(weeks.weekStart, weekStart)))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(
      `The week of ${weekStart} already exists. Delete it first if you want ` +
        'to draw it again.',
    );
  }

  const roster = await loadSchedulingRoster(semester.id);
  const result = generateWeek({
    weekStart,
    members: roster,
    mealDays: semester.mealDays as MealDayConfig,
    slotSizes: semester.slotSizes as Record<Meal, number>,
  });

  const locksAt =
    options.locksAt ?? new Date(`${chapterLockFor(weekStart)}T23:59:59Z`);

  const [week] = await db
    .insert(weeks)
    .values({
      semesterId: semester.id,
      weekStart,
      status: 'posted',
      seed: weekStart,
      postedAt: new Date(),
      locksAt,
      isBootstrap: options.isBootstrap ?? false,
    })
    .returning();

  // neon-http has no interactive transactions, so these writes are sequential.
  // Safe here because generation is admin-triggered and a failed draft can be
  // discarded and rebuilt; nothing downstream reads a half-written draft.
  const slotRows = await db
    .insert(slotsTable)
    .values(
      result.week.slots.map((s) => ({
        weekId: week.id,
        date: s.date,
        meal: s.meal,
        size: s.size,
      })),
    )
    .returning();

  const slotIdByKey = new Map(slotRows.map((s) => [`${s.date}|${s.meal}`, s.id]));
  const rationaleByKey = new Map(
    result.rationale.map((r) => [`${r.date}|${r.meal}|${r.memberId}`, r]),
  );

  const assignmentValues = result.week.slots.flatMap((s) =>
    s.assignments.map((a) => ({
      slotId: slotIdByKey.get(`${s.date}|${s.meal}`)!,
      memberId: a.memberId,
      status: a.status,
      multiplier: a.multiplier,
      isMakeup: a.isMakeup,
      rationale: rationaleByKey.get(`${s.date}|${s.meal}|${a.memberId}`) ?? null,
    })),
  );

  if (assignmentValues.length > 0) {
    await db.insert(assignmentsTable).values(assignmentValues);
    await creditNewAssignments(week.id);
  }

  await db.insert(events).values({
    action: 'week.posted',
    entityType: 'week',
    entityId: week.id,
    actorName: 'scheduler',
    summary: `Posted week of ${weekStart} (${assignmentValues.length} assignments)`,
    payload: {
      weekStart,
      assignments: assignmentValues.length,
      unfilled: result.unfilled,
      isBootstrap: options.isBootstrap ?? false,
    },
  });

  return { week, result, assignmentCount: assignmentValues.length };
}

/* ------------------------------------------------------------------ */
/* Reading a week back for display                                     */
/* ------------------------------------------------------------------ */

export interface DisplayAssignment {
  id: string;
  memberId: string;
  memberName: string;
  status: string;
  multiplier: number;
  isMakeup: boolean;
  coveredByMemberId: string | null;
  coveredByName: string | null;
}

export interface DisplaySlot {
  id: string;
  date: string;
  meal: Meal;
  size: number;
  /** What an unfilled seat on this shift pays. */
  coverBounty: number;
  assignments: DisplayAssignment[];
}

export interface DisplayWeek {
  id: string;
  weekStart: string;
  status: string;
  postedAt: Date | null;
  locksAt: Date | null;
  isBootstrap: boolean;
  days: { date: string; lunch: DisplaySlot | null; dinner: DisplaySlot | null }[];
}

export async function getWeek(weekStart: string): Promise<DisplayWeek | null> {
  const semester = await getActiveSemester();

  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.semesterId, semester.id), eq(weeks.weekStart, weekStart)))
    .limit(1);

  if (!week) return null;

  const slotRows = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.weekId, week.id))
    .orderBy(asc(slotsTable.date));

  const slotIds = slotRows.map((s) => s.id);
  const assignmentRows = slotIds.length
    ? await db
        .select()
        .from(assignmentsTable)
        .where(inArray(assignmentsTable.slotId, slotIds))
    : [];

  const memberIds = [
    ...new Set(
      assignmentRows.flatMap((a) =>
        [a.memberId, a.coveredByMemberId].filter(Boolean as never as (x: unknown) => x is string),
      ),
    ),
  ];

  const memberRows = memberIds.length
    ? await db
        .select({ id: membersTable.id, name: membersTable.name })
        .from(membersTable)
        .where(inArray(membersTable.id, memberIds))
    : [];
  const nameById = new Map(memberRows.map((m) => [m.id, m.name]));

  const bySlot = new Map<string, DisplayAssignment[]>();
  for (const a of assignmentRows) {
    const list = bySlot.get(a.slotId) ?? [];
    list.push({
      id: a.id,
      memberId: a.memberId,
      memberName: nameById.get(a.memberId) ?? 'Unknown',
      status: a.status,
      multiplier: a.multiplier,
      isMakeup: a.isMakeup,
      coveredByMemberId: a.coveredByMemberId,
      coveredByName: a.coveredByMemberId
        ? (nameById.get(a.coveredByMemberId) ?? null)
        : null,
    });
    bySlot.set(a.slotId, list);
  }

  const toDisplay = (s: (typeof slotRows)[number]): DisplaySlot => ({
    id: s.id,
    date: s.date,
    meal: s.meal,
    size: s.size,
    coverBounty: s.coverBounty,
    assignments: (bySlot.get(s.id) ?? []).sort((a, b) =>
      a.memberName.localeCompare(b.memberName),
    ),
  });

  const days = weekDates(weekStart)
    .map((date) => ({
      date,
      lunch: slotRows.find((s) => s.date === date && s.meal === 'lunch')
        ? toDisplay(slotRows.find((s) => s.date === date && s.meal === 'lunch')!)
        : null,
      dinner: slotRows.find((s) => s.date === date && s.meal === 'dinner')
        ? toDisplay(slotRows.find((s) => s.date === date && s.meal === 'dinner')!)
        : null,
    }))
    // A day with no service at all (Saturday) is not shown.
    .filter((d) => d.lunch || d.dinner);

  return {
    id: week.id,
    weekStart: week.weekStart,
    status: week.status,
    postedAt: week.postedAt,
    locksAt: week.locksAt,
    isBootstrap: week.isBootstrap,
    days,
  };
}

/** The two weeks the house cares about: the one running, and the one posted. */
export async function getLiveWeeks() {
  const semester = await getActiveSemester();
  const rows = await db
    .select()
    .from(weeks)
    .where(eq(weeks.semesterId, semester.id))
    .orderBy(asc(weeks.weekStart));

  return rows;
}

export { addDays };

/**
 * How far into the future the schedule actually goes.
 *
 * Shown to brothers so "nothing scheduled" is never ambiguous between "you
 * have no shifts" and "Roman has not posted that far yet" - which is exactly
 * the confusion that leads to someone insisting they were never told.
 */
export interface ScheduleHorizon {
  /** Last date with any assigned slot, or null if nothing is posted. */
  lastDate: string | null;
  /** Monday of the furthest posted week. */
  lastWeekStart: string | null;
  weeksPosted: number;
}

export async function getScheduleHorizon(): Promise<ScheduleHorizon> {
  const semester = await getActiveSemester();

  const weekRows = await db
    .select()
    .from(weeks)
    .where(eq(weeks.semesterId, semester.id))
    .orderBy(asc(weeks.weekStart));

  if (weekRows.length === 0) {
    return { lastDate: null, lastWeekStart: null, weeksPosted: 0 };
  }

  const slotRows = await db
    .select({ date: slotsTable.date })
    .from(slotsTable)
    .where(
      inArray(
        slotsTable.weekId,
        weekRows.map((w) => w.id),
      ),
    );

  const lastDate = slotRows.length
    ? slotRows.map((s) => s.date).sort().at(-1)!
    : null;

  return {
    lastDate,
    lastWeekStart: weekRows.at(-1)!.weekStart,
    weeksPosted: weekRows.length,
  };
}
