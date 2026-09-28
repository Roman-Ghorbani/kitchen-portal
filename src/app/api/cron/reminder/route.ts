/**
 * Day-before reminder.
 *
 * Forgetting is the single biggest cause of a missed shift, so this posts
 * tomorrow's crew to #kitchen-duty and @mentions them where a Slack id is
 * known. Anyone without one is named in plain text instead - a reminder that
 * reaches most people is worth far more than one that waits for a complete
 * mapping.
 *
 * Triggered daily by a systemd timer on the Pi (deploy/kitchen-portal-reminder.*)
 * with CRON_SECRET as a bearer token. Refuses to run at all without one.
 */

import { eq, inArray, asc } from 'drizzle-orm';

import { db } from '../../../../db/index.ts';
import {
  members,
  weeks,
  slots as slotsTable,
  assignments as assignmentsTable,
} from '../../../../db/schema.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { announceTomorrow, slackConfigured } from '../../../../lib/slack.ts';
import { addDays, todayInEastern } from '../../../../lib/dates.ts';
import { safeEqual } from '../../../../lib/auth.ts';
import { appUrl } from '../../../../lib/site.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: 'CRON_SECRET is not set.' },
      { status: 500 },
    );
  }
  if (!safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const semester = await getActiveSemester();
    const tomorrow = addDays(todayInEastern(), 1);

    const weekRows = await db
      .select()
      .from(weeks)
      .where(eq(weeks.semesterId, semester.id));

    if (weekRows.length === 0) {
      return Response.json({ ok: true, message: 'no weeks posted', date: tomorrow });
    }

    const slotRows = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.date, tomorrow))
      .orderBy(asc(slotsTable.meal));

    if (slotRows.length === 0) {
      return Response.json({
        ok: true,
        message: 'no meal service tomorrow',
        date: tomorrow,
      });
    }

    const assignmentRows = await db
      .select()
      .from(assignmentsTable)
      .where(
        inArray(
          assignmentsTable.slotId,
          slotRows.map((s) => s.id),
        ),
      );

    const ids = [
      ...new Set(
        assignmentRows.flatMap((a) =>
          [a.memberId, a.coveredByMemberId].filter((x): x is string => Boolean(x)),
        ),
      ),
    ];

    const people = ids.length
      ? await db
          .select({
            id: members.id,
            name: members.name,
            slackUserId: members.slackUserId,
          })
          .from(members)
          .where(inArray(members.id, ids))
          .then((rows) => new Map(rows.map((r) => [r.id, r])))
      : new Map();

    const crews = slotRows.map((slot) => ({
      meal: slot.meal,
      people: assignmentRows
        .filter((a) => a.slotId === slot.id && a.status !== 'excused')
        .map((a) => {
          const who = people.get(a.coveredByMemberId ?? a.memberId);
          return {
            name: who?.name ?? 'Unknown',
            slackUserId: who?.slackUserId ?? null,
            needsCover: a.status === 'flagged',
          };
        }),
    }));

    const notified = await announceTomorrow(tomorrow, crews, appUrl());

    return Response.json({
      ok: true,
      date: tomorrow,
      crews: crews.map((c) => ({
        meal: c.meal,
        count: c.people.length,
        mentionable: c.people.filter((p) => p.slackUserId).length,
      })),
      slackConfigured: slackConfigured(),
      notified,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
