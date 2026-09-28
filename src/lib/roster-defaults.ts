/**
 * Stored house defaults for the roster (Settings → Roster defaults), merged
 * over the built-in ones so a new class year or setting never reads as
 * undefined.
 */

import { getSetting, setSetting } from './app-settings.ts';
import { DEFAULT_ROSTER_DEFAULTS, type RosterDefaults } from './roster-plan.ts';

const KEY = 'roster.defaults';

export async function getRosterDefaults(): Promise<RosterDefaults> {
  const stored = await getSetting<Partial<RosterDefaults>>(KEY, {});
  return {
    crewForYear: { ...DEFAULT_ROSTER_DEFAULTS.crewForYear, ...(stored.crewForYear ?? {}) },
    pledgeYears: { ...(stored.pledgeYears ?? {}) },
  };
}

export async function saveRosterDefaults(next: RosterDefaults): Promise<void> {
  await setSetting(KEY, next);
}
