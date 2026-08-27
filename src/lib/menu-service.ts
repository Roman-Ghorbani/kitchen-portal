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
  hasMenu: boolean;
  stale: boolean;
}

export function menuSourceConfigured(): boolean {
  // Always configured now, because it reads from the local DB!
  return true;
}

export async function getDayMenu(date: string): Promise<DayMenu | null> {
  try {
    const config = await getTvSettings();
    const day = (config.menus && config.menus[date]) || {};
    
    const lunch = Array.isArray(day.lunch) ? day.lunch : [];
    const dinner = Array.isArray(day.dinner) ? day.dinner : [];
    
    return {
      date: date,
      lunch: {
        label: config.meals?.lunch?.label || 'Lunch',
        serve: config.meals?.lunch?.serve || '',
        items: lunch.filter((i: any) => i !== null && i !== undefined).map((i: any) => String(i).trim()).filter((i: string) => i.length > 0).slice(0, 20)
      },
      dinner: {
        label: config.meals?.dinner?.label || 'Dinner',
        serve: config.meals?.dinner?.serve || '',
        items: dinner.filter((i: any) => i !== null && i !== undefined).map((i: any) => String(i).trim()).filter((i: string) => i.length > 0).slice(0, 20)
      },
      hasMenu: lunch.length > 0 || dinner.length > 0,
      stale: false,
    };
  } catch (err) {
    console.error(`[menu] could not read menu for ${date} from db:`, err);
    return null;
  }
}

export function clearMenuCache(): void {
  // No-op now, we read directly from SQLite which is fast
}
