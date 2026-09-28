/**
 * GET /api/health - liveness for the deploy script and uptime checks.
 *
 * Answers 200 only if the database answers a query. Reveals nothing beyond
 * that: no version, no counts, no hostnames.
 */

import { sqlite } from '../../../db/index.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    sqlite.prepare('SELECT 1').get();
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
