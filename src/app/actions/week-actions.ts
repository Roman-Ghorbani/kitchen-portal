'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '../../lib/session.ts';
import { generateAndSaveWeek } from '../../lib/week-service.ts';
import { mondayOf, addDays } from '../../lib/dates.ts';

export interface WeekActionResult {
  ok: boolean;
  message: string;
}

/**
 * Posts the first week of the semester.
 *
 * Called once. The normal cadence posts a week 8 days ahead at Sunday chapter,
 * but the semester begins the day after the first chapter, so week one cannot
 * get the full 7-day flag window. It is marked isBootstrap so the record shows
 * plainly that this week was an exception rather than the rule.
 */
export async function postBootstrapWeek(
  weekStart: string,
): Promise<WeekActionResult> {
  await requireAdmin();

  try {
    const { assignmentCount, result } = await generateAndSaveWeek(weekStart, {
      post: true,
      isBootstrap: true,
    });

    revalidatePath('/admin');
    revalidatePath('/schedule');

    const short = result.unfilled.length;
    return {
      ok: true,
      message:
        `Posted week of ${weekStart} with ${assignmentCount} assignments` +
        (short > 0 ? `, ${short} slot(s) short` : '') +
        '.',
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Generates and posts the next week on the normal 8-days-ahead cadence. */
export async function postNextWeek(weekStart: string): Promise<WeekActionResult> {
  await requireAdmin();

  try {
    const { assignmentCount, result } = await generateAndSaveWeek(weekStart, {
      post: true,
    });

    revalidatePath('/admin');
    revalidatePath('/schedule');

    return {
      ok: true,
      message:
        `Posted week of ${weekStart} with ${assignmentCount} assignments` +
        (result.unfilled.length > 0
          ? `, ${result.unfilled.length} slot(s) short`
          : '') +
        '.',
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function suggestNextWeekStart(existing: string[]): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  if (existing.length === 0) return mondayOf(today);
  const latest = existing.slice().sort().at(-1)!;
  return addDays(latest, 7);
}
