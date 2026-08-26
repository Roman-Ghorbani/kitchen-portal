/**
 * The day's menu, pulled from the kitchen TV Pi over the tailnet.
 *
 * The Pi is where menus are actually entered (the admin console at
 * `zbt-kitchen-tv:8080/admin.html`), so it is the source of truth and this app
 * is a reader. Nothing is stored here beyond a short in-process cache.
 *
 * Three rules, because this is a second machine on a home network and it will
 * be unreachable sooner or later:
 *
 *  1. **It never throws.** A page that renders a menu must render without one.
 *  2. **It never blocks a page for long.** One second, then give up.
 *  3. **A stale menu beats no menu.** The last good answer is served while the
 *     Pi is unreachable, with `stale` set so the UI can say so if it wants to.
 *
 * Set `MENU_SOURCE_URL` to reach it, e.g.
 * `http://zbt-kitchen-tv:8080/api/menu`. Unset, this is simply off - which is
 * the right behaviour on a laptop that is not on the tailnet.
 */

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
  /** True when this came from cache because the Pi could not be reached. */
  stale: boolean;
}

const TIMEOUT_MS = 1000;

/**
 * Long enough that a page refresh does not hit the Pi again, short enough that
 * a menu corrected at 4:25 is on the site before dinner.
 */
const FRESH_MS = 60_000;

interface CacheEntry {
  menu: DayMenu;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function menuSourceConfigured(): boolean {
  return Boolean(process.env.MENU_SOURCE_URL);
}

/**
 * The menu for one ISO date, or null if there is nothing to show.
 *
 * Null means "say nothing about the menu" - not configured, never reached, and
 * no cache. Callers should render no menu section at all rather than an empty
 * one, because an empty card reads as "no food" rather than "no data".
 */
export async function getDayMenu(date: string): Promise<DayMenu | null> {
  const base = process.env.MENU_SOURCE_URL;
  if (!base) return null;

  const cached = cache.get(date);
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached.menu;

  try {
    const url = new URL(base);
    url.searchParams.set('date', date);

    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`menu source returned ${res.status}`);

    const menu = parseMenu(date, await res.json());
    cache.set(date, { menu, fetchedAt: Date.now() });
    return menu;
  } catch (error) {
    // Expected whenever the Pi is off, rebooting, or the tailnet is down. Log
    // it once at info volume rather than treating it as a page failure.
    console.info(
      `[menu] could not reach the kitchen TV for ${date}:`,
      error instanceof Error ? error.message : error,
    );
    return cached ? { ...cached.menu, stale: true } : null;
  }
}

/**
 * Trusts nothing from the wire.
 *
 * The Pi is a machine on a home network that Roman also edits by hand; a menu
 * item that arrives as a number should render as a string, not crash a page.
 */
function parseMenu(date: string, raw: unknown): DayMenu {
  const body = (raw ?? {}) as Record<string, unknown>;

  const meal = (key: 'lunch' | 'dinner', fallbackLabel: string): MenuMeal => {
    const m = (body[key] ?? {}) as Record<string, unknown>;
    const items = Array.isArray(m.items)
      ? m.items
          // Drop null/undefined before stringifying: String(null) is the string
          // "null", which is non-empty and would render on the board as a menu
          // item called null.
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

/** Testing seam - the cache is process-wide and would otherwise leak between tests. */
export function clearMenuCache(): void {
  cache.clear();
}
