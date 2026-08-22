'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '../../db/index.ts';
import { semesters, events } from '../../db/schema.ts';
import { requireAdmin } from '../../lib/session.ts';
import { getActiveSemester } from '../../lib/week-service.ts';
import type { Meal, MealDayConfig } from '../../lib/types.ts';

const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export interface SettingsResult {
  ok: boolean;
  message: string;
}

/**
 * Turns a day's meal service on or off.
 *
 * Only affects weeks generated from now on. A week already posted keeps the
 * slots it was posted with, because changing what people were already told
 * would defeat the point of having a record.
 */
export async function toggleMealDay(
  meal: Meal,
  dayIndex: number,
  enabled: boolean,
): Promise<SettingsResult> {
  const admin = await requireAdmin();

  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    return { ok: false, message: 'Not a valid day.' };
  }

  const semester = await getActiveSemester();
  const config = structuredClone(semester.mealDays as MealDayConfig);
  config[meal][dayIndex] = enabled;

  const anyService = config.lunch.some(Boolean) || config.dinner.some(Boolean);
  if (!anyService) {
    return {
      ok: false,
      message: 'You cannot turn off every meal — there would be nothing to schedule.',
    };
  }

  await db
    .update(semesters)
    .set({ mealDays: config })
    .where(eq(semesters.id, semester.id));

  await db.insert(events).values({
    action: 'settings.meal_days_changed',
    entityType: 'semester',
    entityId: semester.id,
    actorName: admin.name,
    summary: `${admin.name} turned ${meal} on ${DAY_NAMES[dayIndex]} ${
      enabled ? 'on' : 'off'
    }`,
    payload: { meal, dayIndex, enabled },
  });

  revalidatePath('/admin/settings');
  revalidatePath('/admin');

  const lunchDays = config.lunch.filter(Boolean).length;
  const dinnerDays = config.dinner.filter(Boolean).length;

  return {
    ok: true,
    message:
      `${meal} on ${DAY_NAMES[dayIndex]} is ${enabled ? 'on' : 'off'}. ` +
      `Now ${lunchDays * 2 + dinnerDays * 3} seats a week. ` +
      'Already-posted weeks are unchanged.',
  };
}
