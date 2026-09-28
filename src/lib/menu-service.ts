/**
 * The house menu.
 *
 * Chefs enter it on the kitchen tablet; brothers see it on the Menu tab while
 * deciding on a late plate, out-of-house seniors see it on /menu, and the
 * house display shows it on the dining room TV. One row per date in `menus`.
 */

import { and, gte, lte, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { menus } from '../db/schema.ts';

export interface MenuMeal {
  label: string;
  serve: string;
  items: string[];
}

export interface DayMenu {
  date: string;
  lunch: MenuMeal;
  dinner: MenuMeal;
  /** False when nobody has entered anything for this day. */
  hasMenu: boolean;
  /** True when this came from the in-memory cache after a read failed. */
  stale: boolean;
}

/** Serving windows as the house states them. Cleanup times live on the slot. */
export const SERVICE_HOURS = {
  lunch: { label: 'Lunch', serve: '11:00 AM – 2:30 PM' },
  dinner: { label: 'Dinner', serve: '4:30 PM – 7:30 PM' },
} as const;

const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 120;

/**
 * A few seconds of caching so one page render asking for the same day three
 * times costs one query, while an edit on the tablet shows up almost at once.
 */
const FRESH_MS = 5_000;
const cache = new Map<string, { menu: DayMenu; at: number }>();

export function sanitizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i !== null && i !== undefined)
    .map((i) => String(i).trim().slice(0, MAX_ITEM_LENGTH))
    .filter((i) => i.length > 0)
    .slice(0, MAX_ITEMS);
}

function shape(date: string, lunch: string[], dinner: string[], stale = false): DayMenu {
  return {
    date,
    lunch: { ...SERVICE_HOURS.lunch, items: lunch },
    dinner: { ...SERVICE_HOURS.dinner, items: dinner },
    hasMenu: lunch.length > 0 || dinner.length > 0,
    stale,
  };
}

export async function getDayMenu(date: string): Promise<DayMenu | null> {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.menu;

  try {
    const [row] = await db.select().from(menus).where(eq(menus.date, date)).limit(1);
    const menu = shape(date, sanitizeItems(row?.lunch), sanitizeItems(row?.dinner));
    cache.set(date, { menu, at: Date.now() });
    return menu;
  } catch (err) {
    console.error(`[menu] could not read the menu for ${date}:`, err);
    return cached ? { ...cached.menu, stale: true } : null;
  }
}

/** Every day in [from, to] that has a menu, keyed by date. */
export async function getMenusInRange(from: string, to: string): Promise<Map<string, DayMenu>> {
  const rows = await db
    .select()
    .from(menus)
    .where(and(gte(menus.date, from), lte(menus.date, to)));
  return new Map(
    rows.map((r) => [r.date, shape(r.date, sanitizeItems(r.lunch), sanitizeItems(r.dinner))]),
  );
}

/**
 * Saves one day. A meal left undefined keeps what it had; a day with nothing
 * on either meal is deleted rather than stored empty.
 */
export async function saveDayMenu(
  date: string,
  meal: { lunch?: string[]; dinner?: string[] },
): Promise<DayMenu> {
  await saveWeekMenus({ [date]: meal });
  return (await getDayMenu(date))!;
}

export async function saveWeekMenus(
  days: Record<string, { lunch?: string[]; dinner?: string[] }>,
): Promise<void> {
  db.transaction((tx) => {
    for (const [date, meal] of Object.entries(days)) {
      const [existing] = tx.select().from(menus).where(eq(menus.date, date)).limit(1).all();
      const lunch = sanitizeItems(meal.lunch !== undefined ? meal.lunch : existing?.lunch);
      const dinner = sanitizeItems(meal.dinner !== undefined ? meal.dinner : existing?.dinner);

      if (lunch.length === 0 && dinner.length === 0) {
        tx.delete(menus).where(eq(menus.date, date)).run();
      } else {
        tx.insert(menus)
          .values({ date, lunch, dinner, updatedAt: new Date() })
          .onConflictDoUpdate({ target: menus.date, set: { lunch, dinner, updatedAt: new Date() } })
          .run();
      }
    }
  });
  cache.clear();
}
