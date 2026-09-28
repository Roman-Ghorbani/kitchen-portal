/**
 * The complete audit log, searchable and filterable.
 *
 * Every consequential write in the app appends to `events`; this is where the
 * manager reads all of it. Filters are a plain GET form, so each view is a
 * URL that can be bookmarked, shared or exported, and the page works with
 * scripting off. Filtering and paging happen in SQL - the page never loads
 * more than one page of rows.
 *
 *   q           free text over summary, action, actor and payload
 *   categories  action families (shift, week, late-plate, auth, ...)
 *   action      one exact action
 *   roles       who acted: brother, manager, kitchen tablet, system, anonymous
 *   member      anything a brother did, or that was done to him or his shifts
 *   entity      what kind of record the event is about
 *   from / to   an inclusive date range on the house clock
 *   sort, size, page
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import { members, ACTOR_ROLES } from '../../../../db/schema.ts';
import { getSession } from '../../../../lib/session.ts';
import { queryAudit, auditFacets, AUDIT_PAGE_SIZES } from '../../../../lib/audit.ts';
import { addDays, todayInEastern } from '../../../../lib/dates.ts';
import { AppShell } from '../../shell.tsx';
import { parseAuditParams, auditQuery, type SearchParams } from './params.ts';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<(typeof ACTOR_ROLES)[number], string> = {
  brother: 'Brother',
  manager: 'Manager',
  kiosk: 'Kitchen tablet',
  system: 'System',
  anonymous: 'Not signed in',
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Sign-ins & security',
  member: 'Accounts',
  week: 'Weeks',
  shift: 'Shifts & cover',
  slot: 'Open seats',
  attendance: 'Attendance',
  roster: 'Roster & points',
  availability: 'Availability',
  'late-plate': 'Late plates',
  kiosk: 'Kitchen tablet',
  settings: 'Settings',
  audit: 'Audit exports',
};

const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const filters = parseAuditParams(await searchParams);
  const [result, facets, roster] = await Promise.all([
    queryAudit(filters),
    auditFacets(),
    db.select({ id: members.id, name: members.name }).from(members).orderBy(asc(members.name)),
  ]);

  const today = todayInEastern();
  const memberName = new Map(roster.map((m) => [m.id, m.name]));
  const anyFilter = auditQuery({ ...filters, page: 1, sort: 'newest', pageSize: 50 }) !== '';
  const firstRow = (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.total, result.page * result.pageSize);

  const presets: Array<{ label: string; href: string }> = [
    { label: 'Last 24 hours', href: auditQuery({ from: addDays(today, -1), to: today }) },
    { label: 'Sign-ins', href: auditQuery({ categories: ['auth'] }) },
    { label: 'Failed sign-ins', href: auditQuery({ categories: ['auth', 'kiosk'], roles: ['anonymous'] }) },
    { label: 'Points & attendance', href: auditQuery({ categories: ['attendance', 'roster', 'shift'] }) },
    { label: 'Late plates', href: auditQuery({ categories: ['late-plate'] }) },
    { label: 'Manager actions', href: auditQuery({ roles: ['manager'] }) },
  ];

  return (
    <AppShell
      session={session}
      active="/admin/audit"
      title="Audit log"
      subtitle={`${facets.total.toLocaleString()} events${
        facets.first ? ` since ${facets.first.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}` : ''
      } · append-only`}
    >
      <nav className="audit-presets" aria-label="Common views">
        {presets.map((p) => (
          <Link key={p.label} className="chip" href={`/admin/audit${p.href}`}>
            {p.label}
          </Link>
        ))}
      </nav>

      <form className="card card-pad audit-filters" method="get" action="/admin/audit">
        <div className="audit-filter-grid">
          <label className="audit-field audit-field-wide">
            <span>Search</span>
            <input
              className="field"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Name, reason, action, IP address…"
            />
          </label>

          <label className="audit-field">
            <span>Brother involved</span>
            <select className="field" name="member" defaultValue={filters.memberId ?? ''}>
              <option value="">Anyone</option>
              {roster.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-field">
            <span>Exact action</span>
            <select className="field" name="action" defaultValue={filters.actions?.[0] ?? ''}>
              <option value="">Any action</option>
              {facets.actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action} ({a.n})
                </option>
              ))}
            </select>
          </label>

          <label className="audit-field">
            <span>About</span>
            <select className="field" name="entity" defaultValue={filters.entityType ?? ''}>
              <option value="">Any record</option>
              {facets.entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-field">
            <span>From</span>
            <input className="field" type="date" name="from" defaultValue={filters.from} max={today} />
          </label>
          <label className="audit-field">
            <span>To</span>
            <input className="field" type="date" name="to" defaultValue={filters.to} max={today} />
          </label>

          <label className="audit-field">
            <span>Order</span>
            <select className="field" name="sort" defaultValue={filters.sort}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <label className="audit-field">
            <span>Per page</span>
            <select className="field" name="size" defaultValue={String(result.pageSize)}>
              {AUDIT_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="audit-checks">
          <legend>Category</legend>
          {facets.categories.map((c) => (
            <label key={c} className="check-chip">
              <input type="checkbox" name="categories" value={c} defaultChecked={filters.categories?.includes(c)} />
              <span>{CATEGORY_LABELS[c] ?? c}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="audit-checks">
          <legend>Done by</legend>
          {ACTOR_ROLES.map((r) => (
            <label key={r} className="check-chip">
              <input type="checkbox" name="roles" value={r} defaultChecked={filters.roles?.includes(r)} />
              <span>{ROLE_LABELS[r]}</span>
            </label>
          ))}
        </fieldset>

        <div className="audit-actions">
          <button className="btn primary sm" type="submit">
            Apply filters
          </button>
          {anyFilter && (
            <Link className="btn sm" href="/admin/audit">
              Clear
            </Link>
          )}
          <a className="btn sm" href={`/admin/audit/export${auditQuery({ ...filters, page: 1 })}`}>
            Export CSV
          </a>
        </div>
      </form>

      <div className="audit-summary">
        {result.total === 0
          ? 'No events match.'
          : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${result.total.toLocaleString()}`}
      </div>

      {result.rows.length > 0 && (
        <div className="card audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Who</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((e) => {
                const role = (e.actorRole ?? 'system') as (typeof ACTOR_ROLES)[number];
                const ip = (e.payload as { ip?: string } | null)?.ip;
                return (
                  <tr key={e.id}>
                    <td className="mono audit-when">{timeFmt.format(e.createdAt)}</td>
                    <td>
                      <Link className="audit-action" href={`/admin/audit${auditQuery({ actions: [e.action] })}`}>
                        {e.action}
                      </Link>
                    </td>
                    <td>
                      <span className={`role-chip role-${role}`}>{ROLE_LABELS[role]}</span>
                      {e.actorMemberId ? (
                        <Link href={`/admin/audit${auditQuery({ memberId: e.actorMemberId })}`}>
                          {e.actorName ?? memberName.get(e.actorMemberId)}
                        </Link>
                      ) : (
                        e.actorName && <span>{e.actorName}</span>
                      )}
                    </td>
                    <td>
                      <div>{e.summary}</div>
                      <details className="audit-details">
                        <summary>Details</summary>
                        <dl>
                          <dt>Event</dt>
                          <dd className="mono">{e.id}</dd>
                          <dt>About</dt>
                          <dd className="mono">
                            {e.entityType}
                            {e.entityId ? ` · ${e.entityId}` : ''}
                            {e.entityType === 'member' && e.entityId && memberName.has(e.entityId)
                              ? ` (${memberName.get(e.entityId)})`
                              : ''}
                          </dd>
                          <dt>Recorded</dt>
                          <dd className="mono">{e.createdAt.toISOString()}</dd>
                          {ip && (
                            <>
                              <dt>IP</dt>
                              <dd className="mono">{ip}</dd>
                            </>
                          )}
                        </dl>
                        {e.payload != null && <pre className="audit-payload">{JSON.stringify(e.payload, null, 2)}</pre>}
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.pages > 1 && (
        <nav className="audit-pager" aria-label="Pages">
          {result.page > 1 ? (
            <Link className="btn sm" href={`/admin/audit${auditQuery(filters, { page: result.page - 1 })}`}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="mono">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link className="btn sm" href={`/admin/audit${auditQuery(filters, { page: result.page + 1 })}`}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </AppShell>
  );
}
