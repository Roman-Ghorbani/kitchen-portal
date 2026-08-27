import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { tvSettings } from '../db/schema.ts';

// Every key the display understands, with a safe default.
export const DEFAULTS = {
  uiScale: 1,
  safeMargin: 0,
  title: 'ZETA BETA TAU',
  subtitle: 'ALPHA ALPHA CHAPTER',
  crestImage: '',
  crestSize: 'medium',
  panels: { kitchen: true, weather: true, announcements: true, ticker: true, latePlates: false },
  weather: {
    label: 'West Lafayette',
    latitude: 40.4237,
    longitude: -86.9212,
    timezone: 'America/Indiana/Indianapolis'
  },
  meals: {
    lunch: { label: 'Lunch', serve: '11:00 AM – 2:30 PM', cleanup: 'Cleanup: Juniors, 2:30 PM' },
    dinner: { label: 'Dinner', serve: '4:30 PM – 7:30 PM', cleanup: 'Cleanup: Sophomores, 7:30 PM' }
  },
  menus: {} as Record<string, any>,
  coverNote: 'Any brother can claim an open shift in the app',
  lunchRecap: true,
  dutyChecklist: {
    enabled: true,
    title: 'Dinner Duty Checklist',
    start: '7:30 PM',
    end: '9:30 PM',
    dutyEnds: '9:00 PM',
    items: [
      'Scrape and rack every dish, then run the dish machine until the racks are clear',
      'Wipe down all prep tables, the serving line and the island with sanitiser',
      'Sweep the kitchen and dining room floors, then mop the kitchen',
      'Take out all trash and recycling to the bins behind the house',
      'Break down cardboard and stack it flat by the back door',
      'Wipe the front of the fridges, oven and dish machine',
      'Put clean dishes away and reset the serving line for breakfast'
    ]
  },
  latePlates: {
    enabled: false,
    baseUrl: '', // Not used now, but kept for compatibility
    token: '',
    showNames: true,
    meals: 'auto'
  },
  announcementSettings: {
    layout: 'auto',
    pageSeconds: 15,
    adaptiveTimer: true,
    minPageSeconds: 8,
    maxPageSeconds: 30,
    density: 'comfortable',
    autoFill: true,
    showProgress: true
  },
  announcements: [
    {
      title: 'Chapter Meeting',
      body: 'Sunday at 7:00 PM in the Chapter Room.',
      image: '', imageSize: 'medium', imageFit: 'cover', imageLayout: 'auto', imageFocus: 'center',
      imageW: 0, imageH: 0,
      accent: 'gold', emphasis: 'normal', label: '', when: '',
      span: 'auto', starts: '', ends: '', pinned: false
    }
  ],
  tickerText: 'Chapter Sunday @ 7 PM  |  Check the app for open shifts  |  Keep the kitchen clean'
};

function deepMerge(base: any, override: any): any {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }
  const out = Object.assign({}, base);
  for (const key of Object.keys(override || {})) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

export async function getTvSettings() {
  const rows = await db.select().from(tvSettings).limit(1);
  if (rows.length === 0) {
    // If no settings exist yet, return defaults
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  return deepMerge(DEFAULTS, rows[0].config);
}

export async function updateTvSettings(incoming: any) {
  const current = await getTvSettings();
  const merged = deepMerge(current, incoming);
  
  // Arrays and maps are replaced wholesale rather than deep-merged
  if (incoming.menus) merged.menus = incoming.menus;
  if (incoming.announcements) merged.announcements = incoming.announcements;
  if (incoming.dutyChecklist && incoming.dutyChecklist.items) {
    merged.dutyChecklist.items = incoming.dutyChecklist.items;
  }
  
  const rows = await db.select().from(tvSettings).limit(1);
  if (rows.length === 0) {
    await db.insert(tvSettings).values({ config: merged });
  } else {
    await db.update(tvSettings).set({ config: merged, updatedAt: new Date() }).where(eq(tvSettings.id, rows[0].id));
  }
  
  return merged;
}
