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

/**
 * Turns brother late-plate requesting on or off.
 *
 * Used by the kitchen manager when testing the feature live or pausing requests.
 */
export async function toggleLatePlates(enabled: boolean): Promise<SettingsResult> {
  const admin = await requireAdmin();
  const semester = await getActiveSemester();

  await db
    .update(semesters)
    .set({ latePlatesEnabled: enabled })
    .where(eq(semesters.id, semester.id));

  await db.insert(events).values({
    action: 'settings.late_plates_toggled',
    entityType: 'semester',
    entityId: semester.id,
    actorName: admin.name,
    summary: `${admin.name} ${enabled ? 'enabled' : 'paused'} late plate requests for brothers`,
    payload: { enabled },
  });

  revalidatePath('/admin/settings');
  revalidatePath('/late-plate');

  return {
    ok: true,
    message: enabled
      ? 'Late plate requests are now open for brothers.'
      : 'Late plate requests are now paused. Brothers will see a notice on the page and request buttons will be disabled.',
  };
}


import { randomBytes } from 'crypto';

export async function generateKioskToken(): Promise<SettingsResult> {
  await requireAdmin();
  const semester = await getActiveSemester();
  const token = randomBytes(16).toString('hex');
  
  await db
    .update(semesters)
    .set({ kioskToken: token })
    .where(eq(semesters.id, semester.id));
    
  revalidatePath('/admin/settings');
  return { ok: true, message: 'Kiosk token regenerated.' };
}

export async function updateLatePlateSettings(message: string, logoUrl: string): Promise<SettingsResult> {
  const admin = await requireAdmin();
  const semester = await getActiveSemester();

  const msg = message.trim() || null;
  const logo = logoUrl.trim() || null;

  await db
    .update(semesters)
    .set({ latePlateMessage: msg, logoUrl: logo })
    .where(eq(semesters.id, semester.id));

  await db.insert(events).values({
    action: 'settings.late_plates_updated',
    entityType: 'semester',
    entityId: semester.id,
    actorName: admin.name,
    summary: `${admin.name} updated late plate banner/logo settings`,
    payload: { message: msg, logoUrl: logo },
  });

  revalidatePath('/admin/settings');
  revalidatePath('/late-plate');

  return { ok: true, message: 'Settings saved successfully.' };
}
