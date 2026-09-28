/**
 * Writing to and reading from the audit log.
 *
 * `events` is append-only: nothing in the app updates or deletes a row. This
 * module is the one place new rows are shaped, so every event carries an
 * explicit actor role, and the one place the log is queried for the manager's
 * audit page.
 */

import { and, desc, asc, eq, gte, lt, like, or, sql, inArray, type SQL } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { events, assignments, ACTOR_ROLES } from '../db/schema.ts';

export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface NewEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorRole: ActorRole;
  actorMemberId?: string | null;
  actorName?: string | null;
  summary: string;
  payload?: unknown;
}

type Writer = Pick<typeof db, 'insert'>;

/** Appends one event. Pass a transaction as `writer` to commit with it. */
export async function logEvent(event: NewEvent, writer: Writer = db): Promise<void> {
  await writer.insert(events).values({
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    actorRole: event.actorRole,
    actorMemberId: event.actorMemberId ?? null,
    actorName: event.actorName ?? null,
    summary: event.summary,
    payload: event.payload ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Querying                                                            */
/* ------------------------------------------------------------------ */

export const AUDIT_PAGE_SIZES = [50, 100, 250] as const;

export interface AuditFilters {
  /** Free text: matched against summary, action, actor name and payload. */
  q?: string;
  /** Exact actions, e.g. ['shift.flagged']. */
  actions?: string[];
  /** Action families, e.g. ['shift', 'auth'] - the part before the dot. */
  categories?: string[];
  roles?: ActorRole[];
  entityType?: string;
  /** Events a member did, or that were done to him or his shifts. */
  memberId?: string;
  /** Inclusive, YYYY-MM-DD on the house clock. */
  from?: string;
  /** Inclusive, YYYY-MM-DD on the house clock. */
  to?: string;
  sort?: 'newest' | 'oldest';
  page?: number;
  pageSize?: number;
}

/** Start of an Eastern calendar day as a Date. DST-safe. */
function easternMidnight(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Noon UTC on that date is the same calendar day in New York; ask Intl what
  // the offset is there and back out to local midnight.
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const tz = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT-4"
  const offsetHours = Number(tz?.replace('GMT', '') || -5);
  return new Date(Date.UTC(y, m - 1, d, -offsetHours, 0, 0));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function buildAuditWhere(f: AuditFilters): SQL | undefined {
  const clauses: SQL[] = [];

  if (f.q?.trim()) {
    const needle = `%${escapeLike(f.q.trim())}%`;
    clauses.push(
      or(
        sql`${events.summary} LIKE ${needle} ESCAPE '\\'`,
        sql`${events.action} LIKE ${needle} ESCAPE '\\'`,
        sql`${events.actorName} LIKE ${needle} ESCAPE '\\'`,
        sql`${events.payload} LIKE ${needle} ESCAPE '\\'`,
      )!,
    );
  }

  if (f.actions?.length) clauses.push(inArray(events.action, f.actions));

  if (f.categories?.length) {
    clauses.push(or(...f.categories.map((c) => like(events.action, `${c}.%`)))!);
  }

  if (f.roles?.length) clauses.push(inArray(events.actorRole, f.roles));

  if (f.entityType) clauses.push(eq(events.entityType, f.entityType));

  if (f.memberId) {
    const id = f.memberId;
    clauses.push(
      or(
        eq(events.actorMemberId, id),
        and(eq(events.entityType, 'member'), eq(events.entityId, id)),
        sql`${events.payload} LIKE ${`%${escapeLike(id)}%`} ESCAPE '\\'`,
        and(
          eq(events.entityType, 'assignment'),
          inArray(
            events.entityId,
            db
              .select({ id: assignments.id })
              .from(assignments)
              .where(or(eq(assignments.memberId, id), eq(assignments.coveredByMemberId, id))),
          ),
        ),
      )!,
    );
  }

  if (f.from && ISO_DATE.test(f.from)) clauses.push(gte(events.createdAt, easternMidnight(f.from)));
  if (f.to && ISO_DATE.test(f.to)) {
    const next = new Date(easternMidnight(f.to).getTime() + 36 * 3600 * 1000);
    // +36h then back to that day's midnight: robust across a DST change.
    const nextIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(next);
    clauses.push(lt(events.createdAt, easternMidnight(nextIso)));
  }

  return clauses.length ? and(...clauses) : undefined;
}

export async function queryAudit(f: AuditFilters) {
  const pageSize = AUDIT_PAGE_SIZES.includes(f.pageSize as 50) ? f.pageSize! : 50;
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const where = buildAuditWhere(f);
  const order = f.sort === 'oldest' ? asc(events.createdAt) : desc(events.createdAt);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(events)
      .where(where)
      .orderBy(order, f.sort === 'oldest' ? asc(events.id) : desc(events.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)` }).from(events).where(where),
  ]);

  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Every matching row, oldest first - for CSV export. Capped for safety. */
export async function exportAudit(f: AuditFilters, cap = 50_000) {
  return db
    .select()
    .from(events)
    .where(buildAuditWhere(f))
    .orderBy(asc(events.createdAt), asc(events.id))
    .limit(cap);
}

/** The vocabulary for the filter controls, read from what is actually logged. */
export async function auditFacets() {
  const [actionRows, entityRows, [range]] = await Promise.all([
    db
      .select({ action: events.action, n: sql<number>`count(*)` })
      .from(events)
      .groupBy(events.action)
      .orderBy(events.action),
    db.selectDistinct({ entityType: events.entityType }).from(events).orderBy(events.entityType),
    db
      .select({
        first: sql<number | null>`min(${events.createdAt})`,
        total: sql<number>`count(*)`,
      })
      .from(events),
  ]);

  const categories = [...new Set(actionRows.map((r) => r.action.split('.')[0]))];
  return {
    actions: actionRows,
    categories,
    entityTypes: entityRows.map((r) => r.entityType),
    first: range.first ? new Date(range.first * 1000) : null,
    total: range.total,
  };
}

/** RFC 4180 CSV with a formula-injection guard for spreadsheet apps. */
export function toCsv(rows: Awaited<ReturnType<typeof exportAudit>>): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['time_utc', 'action', 'actor_role', 'actor_name', 'actor_member_id', 'entity_type', 'entity_id', 'summary', 'payload', 'id'];
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.action,
      r.actorRole,
      r.actorName,
      r.actorMemberId,
      r.entityType,
      r.entityId,
      r.summary,
      r.payload,
      r.id,
    ]
      .map(cell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
