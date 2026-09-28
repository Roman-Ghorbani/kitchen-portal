/**
 * The audit page keeps its whole state in the URL, so every filtered view can
 * be bookmarked, shared, refreshed, or exported with the same parameters.
 */

import { ACTOR_ROLES } from '../../../../db/schema.ts';
import type { AuditFilters, ActorRole } from '../../../../lib/audit.ts';

export type SearchParams = Record<string, string | string[] | undefined>;

const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);

const one = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseAuditParams(sp: SearchParams): AuditFilters {
  return {
    q: one(sp.q),
    actions: list(sp.action),
    categories: list(sp.categories),
    roles: list(sp.roles).filter((r): r is ActorRole => (ACTOR_ROLES as readonly string[]).includes(r)),
    entityType: one(sp.entity),
    memberId: one(sp.member),
    from: one(sp.from),
    to: one(sp.to),
    sort: one(sp.sort) === 'oldest' ? 'oldest' : 'newest',
    page: Number(one(sp.page)) || 1,
    pageSize: Number(one(sp.size)) || 50,
  };
}

/** Back to a query string, dropping empty values and defaults. */
export function auditQuery(f: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  const m = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (m.q) p.set('q', m.q);
  if (m.actions?.length) p.set('action', m.actions.join(','));
  if (m.categories?.length) p.set('categories', m.categories.join(','));
  if (m.roles?.length) p.set('roles', m.roles.join(','));
  if (m.entityType) p.set('entity', m.entityType);
  if (m.memberId) p.set('member', m.memberId);
  if (m.from) p.set('from', m.from);
  if (m.to) p.set('to', m.to);
  if (m.sort === 'oldest') p.set('sort', 'oldest');
  if (m.pageSize && m.pageSize !== 50) p.set('size', String(m.pageSize));
  if (m.page && m.page > 1) p.set('page', String(m.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}
