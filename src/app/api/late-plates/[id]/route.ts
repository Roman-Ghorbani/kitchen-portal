/**
 * PATCH /api/late-plates/:id
 *
 * The chef-side transition - mark a plate ready, or decline it with a reason.
 * Gated to the manager or a paired kitchen tablet; a brother's own
 * cancellation goes through the server action, not here.
 *
 * Marking a plate with allergens or restrictions ready requires
 * `acknowledged: true`. Without it the service refuses and names the flags in
 * the 409 - the acknowledgement is a rule, not a dialog box.
 */

import { NextRequest } from 'next/server.js';

import { setLatePlateStatus } from '../../../../lib/late-plate-service.ts';
import { actorOf, callerOf, canWrite, json, UNAUTHORIZED } from '../../../../lib/api-auth.ts';

export const dynamic = 'force-dynamic';

const ALLOWED = ['waiting', 'ready', 'declined'] as const;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const caller = await callerOf(request);
  if (!canWrite(caller)) return json(UNAUTHORIZED, 401);

  const { id } = await context.params;

  let body: { status?: string; reason?: string; acknowledged?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const status = body.status as (typeof ALLOWED)[number];
  if (!ALLOWED.includes(status)) {
    return json({ error: `status must be one of ${ALLOWED.join(', ')}` }, 400);
  }

  const result = await setLatePlateStatus(
    id,
    status,
    typeof body.reason === 'string' ? body.reason : null,
    actorOf(caller),
    { acknowledged: body.acknowledged === true },
  );

  return json({ ok: result.ok, message: result.message }, result.ok ? 200 : 409);
}
