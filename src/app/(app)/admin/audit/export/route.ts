/**
 * GET /admin/audit/export?<filters> - the filtered audit log as CSV.
 *
 * Same parameters as the page, every matching row oldest first. Exporting is
 * itself logged: the audit trail should show who took a copy of it.
 */

import { NextRequest } from 'next/server.js';

import { callerOf } from '../../../../../lib/api-auth.ts';
import { exportAudit, toCsv, logEvent } from '../../../../../lib/audit.ts';
import { todayInEastern } from '../../../../../lib/dates.ts';
import { parseAuditParams } from '../params.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const caller = await callerOf(request);
  if (caller.session?.role !== 'admin') return new Response('Unauthorized', { status: 401 });

  const filters = parseAuditParams(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await exportAudit(filters);

  await logEvent({
    action: 'audit.exported',
    entityType: 'audit',
    actorRole: 'manager',
    actorName: caller.session.name,
    summary: `${caller.session.name} exported ${rows.length} audit event${rows.length === 1 ? '' : 's'} as CSV`,
    payload: { filters: request.nextUrl.search || null },
  });

  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${todayInEastern()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
