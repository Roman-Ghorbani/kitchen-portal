/**
 * Database schema (SQLite).
 *
 * Two things drive the shape here beyond ordinary CRUD:
 *
 *  1. Assignments are append-only history. A week is never regenerated in
 *     place - once it exists it is the record of what people were told to do,
 *     which is the whole point of the app.
 *
 *  2. Every consequential action writes an `events` row. When somebody
 *     disputes a missed shift, the answer is a timestamped chain: posted on
 *     this date, flag window closed with no flag, marked absent afterwards.
 *
 * SQLite notes, for whoever reads this next:
 *  - Ids are text holding a UUID, generated in JS rather than by the database.
 *  - Dates are text in YYYY-MM-DD, which sorts and compares correctly.
 *  - Timestamps are integers (unix seconds); drizzle hands back Date objects.
 *  - Booleans are 0/1. Enums are text with the allowed set declared.
 */

import { randomUUID } from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const CLASS_YEARS = ['sophomore', 'junior'] as const;
const MEALS = ['lunch', 'dinner'] as const;
const EXEMPT_REASONS = ['officer', 'medical', 'off-campus', 'other'] as const;
const WEEK_STATUSES = ['draft', 'posted', 'locked', 'complete'] as const;
const ASSIGNMENT_STATUSES = [
  'assigned',
  'flagged', // conflict raised; slot open to volunteers
  'covered', // someone else served; only they earn the point
  'no-show', // marked absent; generates make-up debt
  'excused', // waived by the manager, no debt
] as const;
const CONFLICT_SCOPES = ['semester', 'temporary'] as const;

const pk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

const created = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date());

/* ------------------------------------------------------------------ */

export const semesters = sqliteTable('semesters', {
  id: pk(),
  name: text('name').notNull(), // e.g. "Fall 2026"
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),

  /**
   * Which day/meal combinations the house serves, as
   * { lunch: boolean[7], dinner: boolean[7] } with index 0 = Monday.
   * Per-semester so it can change between Fall and Spring.
   */
  mealDays: text('meal_days', { mode: 'json' }).notNull(),
  /** { lunch: 2, dinner: 3 } - house rule, but stored rather than hardcoded. */
  slotSizes: text('slot_sizes', { mode: 'json' }).notNull(),

  createdAt: created(),
});

export const members = sqliteTable(
  'members',
  {
    id: pk(),
    name: text('name').notNull(),
    classYear: text('class_year', { enum: CLASS_YEARS }).notNull(),

    /**
     * Rotation priority. Lower is scheduled sooner. Increments by the
     * assignment multiplier, so a 3x pickup adds 3.
     *
     * Real rather than integer because half-point awards are allowed. Every
     * permitted multiplier is a multiple of 0.5, and halves are exact in
     * binary floating point, so these sums never drift.
     */
    points: real('points').notNull().default(0),

    /** Unworked make-up shifts owed from no-shows. Forces front of queue. */
    makeupDebt: integer('makeup_debt').notNull().default(0),

    exempt: integer('exempt', { mode: 'boolean' }).notNull().default(false),
    exemptReason: text('exempt_reason', { enum: EXEMPT_REASONS }),
    exemptNotes: text('exempt_notes'),

    /**
     * Scrypt hash of the member's 4-digit PIN. Null until they set one on
     * first sign-in. A PIN is weak by design - it exists to make actions
     * attributable, not to secure anything valuable.
     */
    pinHash: text('pin_hash'),

    /** Denormalized from assignments for fast tie-breaking during generation. */
    lastServedDate: text('last_served_date'),

    /**
     * Slack member id (e.g. U01ABC23DEF), so day-before reminders can @mention
     * the actual person rather than printing a name nobody is notified by.
     */
    slackUserId: text('slack_user_id'),

    /** Off the roster (graduated, moved out) without deleting their history. */
    active: integer('active', { mode: 'boolean' }).notNull().default(true),

    createdAt: created(),
  },
  (t) => [
    index('members_year_idx').on(t.classYear),
    index('members_priority_idx').on(t.points, t.lastServedDate),
  ],
);

/**
 * Standing weekly conflicts - the primary defence against last-minute drama.
 * Because class year fixes the meal, one day index per row is sufficient.
 */
export const standingConflicts = sqliteTable(
  'standing_conflicts',
  {
    id: pk(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    semesterId: text('semester_id')
      .notNull()
      .references(() => semesters.id, { onDelete: 'cascade' }),

    /** 0 = Monday ... 6 = Sunday. */
    dayIndex: integer('day_index').notNull(),
    note: text('note'), // "Chem lab"

    scope: text('scope', { enum: CONFLICT_SCOPES }).notNull().default('semester'),
    expiresOn: text('expires_on'),

    createdAt: created(),
  },
  (t) => [
    uniqueIndex('standing_conflict_unique').on(
      t.memberId,
      t.semesterId,
      t.dayIndex,
    ),
  ],
);

export const weeks = sqliteTable(
  'weeks',
  {
    id: pk(),
    semesterId: text('semester_id')
      .notNull()
      .references(() => semesters.id, { onDelete: 'cascade' }),

    /** ISO Monday this week starts. */
    weekStart: text('week_start').notNull(),
    status: text('status', { enum: WEEK_STATUSES }).notNull().default('posted'),

    /** Seed used to generate it, so the draw can be reproduced exactly. */
    seed: text('seed').notNull(),

    postedAt: integer('posted_at', { mode: 'timestamp' }),
    /** Server-anchored deadline. Never trust a phone clock for this. */
    locksAt: integer('locks_at', { mode: 'timestamp' }),
    lockedAt: integer('locked_at', { mode: 'timestamp' }),

    /**
     * True for the one-time first week of a semester, which cannot get the
     * normal full 7-day flag window because the semester starts the day after
     * the first chapter.
     */
    isBootstrap: integer('is_bootstrap', { mode: 'boolean' })
      .notNull()
      .default(false),

    createdAt: created(),
  },
  (t) => [uniqueIndex('weeks_semester_start_unique').on(t.semesterId, t.weekStart)],
);

export const slots = sqliteTable(
  'slots',
  {
    id: pk(),
    weekId: text('week_id')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    meal: text('meal', { enum: MEALS }).notNull(),
    size: integer('size').notNull(),

    /**
     * What an unfilled seat on this shift is worth to whoever claims it.
     *
     * Lives on the slot rather than an assignment because an empty seat has no
     * assignment row to hang it from - and an empty seat is exactly when the
     * manager most needs to offer extra to get somebody to step up.
     */
    coverBounty: real('cover_bounty').notNull().default(1),
  },
  (t) => [
    uniqueIndex('slots_week_date_meal_unique').on(t.weekId, t.date, t.meal),
    index('slots_date_idx').on(t.date),
  ],
);

export const assignments = sqliteTable(
  'assignments',
  {
    id: pk(),
    slotId: text('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),

    status: text('status', { enum: ASSIGNMENT_STATUSES })
      .notNull()
      .default('assigned'),

    /** Who actually served, when someone covered. Only they earn the point. */
    coveredByMemberId: text('covered_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),

    /**
     * Points this shift is worth to whoever serves it. 1 normally; the manager
     * can raise it to 1.5, 2, or 3 to get somebody to step up on short notice.
     */
    multiplier: real('multiplier').notNull().default(1),

    /** This assignment works off make-up debt - the one exception to 1/week. */
    isMakeup: integer('is_makeup', { mode: 'boolean' }).notNull().default(false),

    /**
     * Why the generator chose this person: points at pick time, days since
     * last served, eligible pool size. Frozen at generation so it stays true
     * even after the member's live numbers move on.
     */
    rationale: text('rationale', { mode: 'json' }),

    /** Set when points were actually credited, so we never double-credit. */
    settledAt: integer('settled_at', { mode: 'timestamp' }),

    /**
     * What settlement has already handed out for this shift. Kept so a later
     * attendance correction applies only the difference rather than
     * double-crediting or needing anyone to unwind points by hand.
     */
    pointsAwarded: real('points_awarded').notNull().default(0),
    debtAwarded: integer('debt_awarded').notNull().default(0),
    /** Who last received the points, so credit can be moved cleanly. */
    settledRecipientId: text('settled_recipient_id').references(() => members.id, {
      onDelete: 'set null',
    }),

    createdAt: created(),
  },
  (t) => [
    index('assignments_member_idx').on(t.memberId),
    index('assignments_slot_idx').on(t.slotId),
    uniqueIndex('assignments_slot_member_unique').on(t.slotId, t.memberId),
  ],
);

/**
 * Append-only audit log. This is the liability record - never update or delete
 * a row here. Written for: week posted, week locked, conflict flagged,
 * coverage claimed, attendance corrected, points adjusted, exemption changed,
 * roster edited.
 */
export const events = sqliteTable(
  'events',
  {
    id: pk(),
    action: text('action').notNull(),

    /** What the event is about, e.g. 'assignment' + the assignment id. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),

    /** Who did it. Null for system actions. */
    actorMemberId: text('actor_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    /** Denormalized so the log stays readable if a member is later removed. */
    actorName: text('actor_name'),

    /** Human-readable one-liner for the history view. */
    summary: text('summary').notNull(),
    payload: text('payload', { mode: 'json' }),

    createdAt: created(),
  },
  (t) => [
    index('events_entity_idx').on(t.entityType, t.entityId),
    index('events_actor_idx').on(t.actorMemberId),
    index('events_created_idx').on(t.createdAt),
  ],
);
