/**
 * The automated Sunday chapter transition.
 *
 * Vercel Cron calls this. It is also safe to call by hand, and safe to call
 * repeatedly - the transition is idempotent, so a duplicate invocation or a
 * retry after a timeout changes nothing.
 *
 * Protected by CRON_SECRET. Vercel sends it as a bearer token automatically;
 * without the variable set the route refuses rather than running open to the
 * internet, because anyone hitting it could otherwise lock a week early.
 */

import { runChapterTransition } from '../../../../lib/chapter-transition.ts';
import { getLiveWeeks } from '../../../../lib/week-service.ts';
import { getOpenShifts } from '../../../../lib/shift-service.ts';
import {
  announceWeekPosted,
  announceOpenShifts,
  slackConfigured,
} from '../../../../lib/slack.ts';
import { chapterLockFor } from '../../../../lib/dates.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      {
        ok: false,
        error:
          'CRON_SECRET is not set. Refusing to run an unauthenticated transition.',
      },
      { status: 500 },
    );
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runChapterTransition('Sunday cron');

    const notifications: Record<string, unknown> = {
      slackConfigured: slackConfigured(),
    };

    if (result.postedWeek) {
      notifications.weekPosted = await announceWeekPosted(
        result.postedWeek,
        chapterLockFor(result.postedWeek),
        appUrl(),
      );
    }

    const open = await getOpenShifts();
    if (open.length > 0) {
      notifications.openShifts = await announceOpenShifts(
        open.map((o) => ({
          date: o.date,
          meal: o.meal,
          originalName: o.originalName,
        })),
        appUrl(),
      );
    }

    const weeks = await getLiveWeeks();

    return Response.json({
      ok: result.ok,
      message: result.message,
      lockedWeek: result.lockedWeek ?? null,
      postedWeek: result.postedWeek ?? null,
      awaitingApproval: result.unresolved ?? 0,
      weeks: weeks.map((w) => ({ weekStart: w.weekStart, status: w.status })),
      notifications,
    });
  } catch (err) {
    // Returning 500 lets Vercel surface the failure rather than reporting a
    // silent success on a week that never got posted.
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
