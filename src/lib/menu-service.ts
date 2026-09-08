import { getTvSettings, updateTvSettings } from './tv-service.ts';

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
  /** True when this came from cache because the source could not be reached. */
  stale: boolean;
}

/**
 * Short in-memory cache (5 seconds) so repeated lookups within a single page
 * render are instantaneous, while changes made on the kiosk appear almost
 * immediately.
 */
const FRESH_MS = 5_000;

interface CacheEntry {
  menu: DayMenu;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function menuSourceConfigured(): boolean {
  return true;
}

function sanitizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i !== null && i !== undefined)
    .map((i) => String(i).trim())
    .filter((i) => i.length > 0)
    .slice(0, 20);
}

/**
 * Reads a single day's menu directly from the KitchenTracker database.
 */
export async function getDayMenu(date: string): Promise<DayMenu | null> {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return cached.menu;
  }

  try {
    const config = await getTvSettings();
    const day = (config.menus && config.menus[date]) || {};

    const lunchItems = sanitizeItems(day.lunch);
    const dinnerItems = sanitizeItems(day.dinner);

    const result: DayMenu = {
      date,
      lunch: {
        label: config.meals?.lunch?.label || 'Lunch',
        serve: config.meals?.lunch?.serve || '11:00 AM – 2:30 PM',
        items: lunchItems,
      },
      dinner: {
        label: config.meals?.dinner?.label || 'Dinner',
        serve: config.meals?.dinner?.serve || '4:30 PM – 7:30 PM',
        items: dinnerItems,
      },
      hasMenu: lunchItems.length > 0 || dinnerItems.length > 0,
      stale: false,
    };

    cache.set(date, { menu: result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    console.error(`[menu] could not read menu for ${date}:`, err);
    if (cached) return { ...cached.menu, stale: true };
    return null;
  }
}

/**
 * Saves or updates menu items for a specific date.
 */
export async function saveDayMenu(
  date: string,
  mealData: { lunch?: string[]; dinner?: string[] },
): Promise<DayMenu> {
  const config = await getTvSettings();
  const currentMenus = Object.assign({}, config.menus || {});
  const existingDay = currentMenus[date] || {};

  const nextLunch =
    mealData.lunch !== undefined ? sanitizeItems(mealData.lunch) : sanitizeItems(existingDay.lunch);
  const nextDinner =
    mealData.dinner !== undefined ? sanitizeItems(mealData.dinner) : sanitizeItems(existingDay.dinner);

  if (nextLunch.length === 0 && nextDinner.length === 0) {
    delete currentMenus[date];
  } else {
    currentMenus[date] = {
      lunch: nextLunch,
      dinner: nextDinner,
    };
  }

  await updateTvSettings({ menus: currentMenus });
  clearMenuCache();

  return (
    (await getDayMenu(date)) || {
      date,
      lunch: { label: 'Lunch', serve: '', items: nextLunch },
      dinner: { label: 'Dinner', serve: '', items: nextDinner },
      hasMenu: nextLunch.length > 0 || nextDinner.length > 0,
      stale: false,
    }
  );
}

/**
 * Saves a full week / batch of menus keyed by ISO date.
 */
export async function saveWeekMenus(
  menus: Record<string, { lunch?: string[]; dinner?: string[] }>,
): Promise<void> {
  const config = await getTvSettings();
  const currentMenus = Object.assign({}, config.menus || {});

  for (const [date, data] of Object.entries(menus)) {
    const existingDay = currentMenus[date] || {};
    const lunch =
      data.lunch !== undefined ? sanitizeItems(data.lunch) : sanitizeItems(existingDay.lunch);
    const dinner =
      data.dinner !== undefined ? sanitizeItems(data.dinner) : sanitizeItems(existingDay.dinner);

    if (lunch.length === 0 && dinner.length === 0) {
      delete currentMenus[date];
    } else {
      currentMenus[date] = { lunch, dinner };
    }
  }

  await updateTvSettings({ menus: currentMenus });
  clearMenuCache();
}

/**
 * Retrieves menus for all days in a week given the Monday ISO date.
 */
export async function getWeekMenus(
  weekStart: string,
): Promise<Record<string, { lunch: string[]; dinner: string[] }>> {
  const config = await getTvSettings();
  const allMenus = config.menus || {};
  return allMenus;
}

/**
 * Clears cached menu records in memory.
 */
export function clearMenuCache(): void {
  cache.clear();
}

