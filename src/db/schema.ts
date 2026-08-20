/**
 * Database schema.
 *
 * Two things drive the shape here beyond ordinary CRUD:
 *
 *  1. Assignments are append-only history. A posted week is never regenerated
 *     in place - once it locks it is the record of what people were told to do,
 *     which is the whole point of the app.
 *
 *  2. Every consequential action writes an `events` row. When somebody disputes
 *     a missed shift, the answer is a timestamped chain: posted on this date,
 *     viewed on that date, flag window closed with no flag, marked absent.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  date,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const classYearEnum = pgEnum('class_year', ['sophomore', 'junior']);
export const mealEnum = pgEnum('meal', ['lunch', 'dinner']);
export const exemptReasonEnum = pgEnum('exempt_reason', [
  'officer',
  'medical',
  'off-campus',
  'other',
]);
export const weekStatusEnum = pgEnum('week_status', [
  'draft', // generated, not yet shown to the house
  'posted', // visible, flag window open
  'locked', // chapter passed, running or run
  'complete', // attendance settled
]);
export const assignmentStatusEnum = pgEnum('assignment_status', [
  'assigned',
  'flagged', // conflict raised; slot open to volunteers
  'covered', // someone else served; only they earn the point
  'no-show', // marked absent; generates make-up debt
  'excused', // waived by the manager, no debt
]);
export const conflictScopeEnum = pgEnum('conflict_scope', [
  'semester',
  'temporary',
]);

/* ------------------------------------------------------------------ */

export const semesters = pgTable('semesters', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // e.g. "Fall 2026"
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  active: boolean('active').notNull().default(false),

  /**
   * Which day/meal combinations the house serves, as
   * { lunch: boolean[7], dinner: boolean[7] } with index 0 = Monday.
   * Per-semester so it can change between Fall and Spring.
   */
  mealDays: jsonb('meal_days').notNull(),
  /** { lunch: 2, dinner: 3 } - house rule, but stored rather than hardcoded. */
  slotSizes: jsonb('slot_sizes').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const members = pgTable(
  'members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    classYear: classYearEnum('class_year').notNull(),

    /**
     * Rotation priority. Lower is scheduled sooner. Increments by the
     * assignment multiplier, so a 3x bounty pickup adds 3.
     */
    points: integer('points').notNull().default(0),

    /** Unworked make-up shifts owed from no-shows. Forces front of queue. */
    makeupDebt: integer('makeup_debt').notNull().default(0),

    exempt: boolean('exempt').notNull().default(false),
    exemptReason: exemptReasonEnum('exempt_reason'),
    exemptNotes: text('exempt_notes'),

    /**
     * Scrypt hash of the member's 4-digit PIN. Null until they set one on
     * first sign-in. A PIN is weak by design - it exists to make actions
     * attributable, not to secure anything valuable.
     */
    pinHash: text('pin_hash'),

    /** Denormalized from assignments for fast tie-breaking during generation. */
    lastServedDate: date('last_served_date'),

    /** Off the roster (graduated, moved out) without deleting their history. */
    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('members_year_idx').on(t.classYear),
    index('members_priority_idx').on(t.points, t.lastServedDate),
  ],
);

/**
 * Standing weekly conflicts - the primary defense against last-minute drama.
 * Because class year fixes the meal, one day index per row is sufficient.
 */
export const standingConflicts = pgTable(
  'standing_conflicts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    semesterId: uuid('semester_id')
      .notNull()
      .references(() => semesters.id, { onDelete: 'cascade' }),

    /** 0 = Monday ... 6 = Sunday. */
    dayIndex: integer('day_index').notNull(),
    note: text('note'), // "Chem lab"

    /** Semester-long, or a short-lived block that expires. */
    scope: conflictScopeEnum('scope').notNull().default('semester'),
    expiresOn: date('expires_on'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('standing_conflict_unique').on(
      t.memberId,
      t.semesterId,
      t.dayIndex,
    ),
  ],
);

export const weeks = pgTable(
  'weeks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    semesterId: uuid('semester_id')
      .notNull()
      .references(() => semesters.id, { onDelete: 'cascade' }),

    /** ISO Monday this week starts. */
    weekStart: date('week_start').notNull(),
    status: weekStatusEnum('status').notNull().default('draft'),

    /** Seed used to generate it, so the draw can be reproduced exactly. */
    seed: text('seed').notNull(),

    postedAt: timestamp('posted_at', { withTimezone: true }),
    /** Server-anchored deadline. Never trust a phone clock for this. */
    locksAt: timestamp('locks_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),

    /**
     * True for the one-time first week of a semester, which cannot get the
     * normal full 7-day flag window because the semester starts the day after
     * the first chapter.
     */
    isBootstrap: boolean('is_bootstrap').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('weeks_semester_start_unique').on(t.semesterId, t.weekStart)],
);

export const slots = pgTable(
  'slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    weekId: uuid('week_id')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    meal: mealEnum('meal').notNull(),
    size: integer('size').notNull(),
  },
  (t) => [
    uniqueIndex('slots_week_date_meal_unique').on(t.weekId, t.date, t.meal),
    index('slots_date_idx').on(t.date),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),

    status: assignmentStatusEnum('status').notNull().default('assigned'),

    /** Who actually served, when someone covered. Only they earn the point. */
    coveredByMemberId: uuid('covered_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),

    /**
     * Points awarded to whoever served. 1 normally; the manager can award 2 or
     * 3 as a bounty to get someone to step up on short notice.
     */
    multiplier: integer('multiplier').notNull().default(1),

    /** This assignment works off make-up debt - the one exception to 1/week. */
    isMakeup: boolean('is_makeup').notNull().default(false),

    /**
     * Why the generator chose this person: points at pick time, days since
     * last served, eligible pool size. Frozen at generation so it stays true
     * even after the member's live numbers move on.
     */
    rationale: jsonb('rationale'),

    /** Set when points were actually credited, so we never double-credit. */
    settledAt: timestamp('settled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('assignments_member_idx').on(t.memberId),
    index('assignments_slot_idx').on(t.slotId),
    uniqueIndex('assignments_slot_member_unique').on(t.slotId, t.memberId),
  ],
);

/**
 * Append-only audit log. This is the liability record - never update or delete
 * a row here. Written for: week posted, week locked, shift viewed, conflict
 * flagged, coverage claimed, attendance corrected, points adjusted, exemption
 * changed, roster edited.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    action: text('action').notNull(),

    /** What the event is about, e.g. 'assignment' + the assignment id. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),

    /** Who did it. Null for system actions like the scheduled Sunday lock. */
    actorMemberId: uuid('actor_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    /** Denormalized so the log stays readable if a member is later removed. */
    actorName: text('actor_name'),

    /** Human-readable one-liner for the history view. */
    summary: text('summary').notNull(),
    payload: jsonb('payload'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('events_entity_idx').on(t.entityType, t.entityId),
    index('events_actor_idx').on(t.actorMemberId),
    index('events_created_idx').on(t.createdAt),
  ],
);
