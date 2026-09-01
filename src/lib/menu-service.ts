import { getTvSettings } from './tv-service.ts';

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
  /** True when this came from cache because the remote source could not be reached. */
  stale: boolean;
}

const TIMEOUT_MS = 1500;

/**
 * Short in-memory cache (5 seconds) so repeated lookups within a single page
 * render are instantaneous, while changes made on the kitchen-tv appear almost
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

function parseMenu(date: string, raw: unknown): DayMenu {
  const body = (raw ?? {}) as Record<string, unknown>;

  const meal = (key: 'lunch' | 'dinner', fallbackLabel: string): MenuMeal => {
    const m = (body[key] ?? {}) as Record<string, unknown>;
    const items = Array.isArray(m.items)
      ? m.items
          .filter((i) => i !== null && i !== undefined)
          .map((i) => String(i).trim())
          .filter((i) => i.length > 0)
          .slice(0, 20)
      : [];
    return {
      label: typeof m.label === 'string' && m.label ? m.label : fallbackLabel,
      serve: typeof m.serve === 'string' ? m.serve : '',
      items,
    };
  };

  const lunch = meal('lunch', 'Lunch');
  const dinner = meal('dinner', 'Dinner');

  return {
    date: typeof body.date === 'string' ? body.date : date,
    lunch,
    dinner,
    hasMenu: lunch.items.length > 0 || dinner.items.length > 0,
    stale: false,
  };
}

export async function getDayMenu(date: string): Promise<DayMenu | null> {
  const remoteUrl = process.env.MENU_SOURCE_URL || 'http://zbt-kitchen-tv:8080/api/menu';

  // 1. Try pulling from remote kitchen-tv source if configured or available
  if (remoteUrl) {
    const cached = cache.get(date);
    if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
      return cached.menu;
    }

    try {
      const url = new URL(remoteUrl);
      url.searchParams.set('date', date);

      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });

      if (res.ok) {
        const json = await res.json();
        if (json && (json.hasMenu !== undefined || json.success)) {
          const menu = parseMenu(date, json);
          cache.set(date, { menu, fetchedAt: Date.now() });
          return menu;
        }
      }
    } catch (err) {
      // Remote fetch failed (e.g. offline, off tailnet, timeout)
      if (cached) {
        return { ...cached.menu, stale: true };
      }
    }
  }

  // 2. Fallback: read from local SQLite tvSettings table
  try {
    const config = await getTvSettings();
    const day = (config.menus && config.menus[date]) || {};

    const lunch = Array.isArray(day.lunch) ? day.lunch : [];
    const dinner = Array.isArray(day.dinner) ? day.dinner : [];

    const parsedLunch = lunch
      .filter((i: any) => i !== null && i !== undefined)
      .map((i: any) => String(i).trim())
      .filter((i: string) => i.length > 0)
      .slice(0, 20);

    const parsedDinner = dinner
      .filter((i: any) => i !== null && i !== undefined)
      .map((i: any) => String(i).trim())
      .filter((i: string) => i.length > 0)
      .slice(0, 20);

    return {
      date: date,
      lunch: {
        label: config.meals?.lunch?.label || 'Lunch',
        serve: config.meals?.lunch?.serve || '',
        items: parsedLunch,
      },
      dinner: {
        label: config.meals?.dinner?.label || 'Dinner',
        serve: config.meals?.dinner?.serve || '',
        items: parsedDinner,
      },
      hasMenu: parsedLunch.length > 0 || parsedDinner.length > 0,
      stale: false,
    };
  } catch (err) {
    console.error(`[menu] could not read menu for ${date}:`, err);
    return null;
  }
}

export function clearMenuCache(): void {
  cache.clear();
}
