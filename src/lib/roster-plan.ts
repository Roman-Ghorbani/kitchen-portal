/**
 * Turning a roster file into a set of changes, before anything is written.
 *
 * Pure: takes the parsed file, the current roster and the house defaults, and
 * returns what would be added, changed, removed and skipped, with a reason
 * for every skip. The import screen shows this as a preview; applying it
 * re-runs the same function on the server against the live roster, so the
 * preview and the write can never disagree.
 */

import type { ClassYear, ExemptReason, Meal } from './types.ts';
import {
  type IntakeResult,
  type IntakeYear,
  type IntakeCrew,
  isLiveInRoom,
  nameKey,
} from './roster-intake.ts';

/* ------------------------------------------------------------------ */
/* House defaults                                                      */
/* ------------------------------------------------------------------ */

export type CrewDefault = Meal | 'exempt';

export interface RosterDefaults {
  /** Where a new member of each class year goes unless told otherwise. */
  crewForYear: Record<ClassYear, CrewDefault>;
  /** Pledge class → class year, remembered from the last import. */
  pledgeYears: Record<string, ClassYear | 'skip'>;
}

export const DEFAULT_ROSTER_DEFAULTS: RosterDefaults = {
  crewForYear: {
    freshman: 'dinner',
    sophomore: 'dinner',
    junior: 'lunch',
    senior: 'exempt',
    'fifth-year': 'exempt',
    other: 'dinner',
  },
  pledgeYears: {},
};

export interface Placement {
  rotation: Meal;
  exempt: boolean;
  exemptReason: ExemptReason | null;
}

/**
 * Where somebody goes on duty. An explicit rotation wins; otherwise the default
 * for his class year. An exempt brother still carries a rotation - the one he
 * returns to if the exemption is lifted.
 */
export function placement(
  classYear: ClassYear,
  crew: IntakeCrew | undefined,
  defaults: RosterDefaults,
  fallbackRotation: Meal = 'dinner',
): Placement {
  const choice = crew ?? defaults.crewForYear[classYear] ?? 'dinner';
  if (choice === 'exempt') {
    const nominal = defaults.crewForYear[classYear];
    return {
      rotation: nominal === 'lunch' || nominal === 'dinner' ? nominal : fallbackRotation,
      exempt: true,
      exemptReason: classYear === 'senior' || classYear === 'fifth-year' ? 'senior' : 'other',
    };
  }
  return { rotation: choice, exempt: false, exemptReason: null };
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

export interface ImportOptions {
  /** Pledge class → year for rows that have a pledge class but no year. */
  pledgeYears: Record<string, ClassYear | 'skip'>;
  /** With a room column: only people whose room is in the house are imported. */
  liveInOnly: boolean;
  /** Take anyone on the roster who is not in the file off it. */
  removeMissing: boolean;
  /** Put existing members back on their class year's default rotation. */
  resetCrews: boolean;
}

export interface CurrentMember {
  id: string;
  name: string;
  classYear: ClassYear;
  rotation: Meal;
  exempt: boolean;
  exemptReason: ExemptReason | null;
  room: string | null;
  pledgeClass: string | null;
  active: boolean;
}

export interface PlanAdd {
  key: string;
  line: number;
  name: string;
  classYear: ClassYear;
  yearGuessed: boolean;
  room: string | null;
  pledgeClass: string | null;
  placement: Placement;
}

export interface FieldChange {
  field: 'classYear' | 'room' | 'pledgeClass' | 'rotation' | 'exempt' | 'active';
  from: string;
  to: string;
}

export interface PlanUpdate {
  id: string;
  name: string;
  line: number;
  changes: FieldChange[];
  set: Partial<Pick<CurrentMember, 'classYear' | 'room' | 'pledgeClass' | 'rotation' | 'exempt' | 'exemptReason' | 'active'>>;
}

export interface ImportPlan {
  add: PlanAdd[];
  update: PlanUpdate[];
  remove: { id: string; name: string }[];
  unchanged: number;
  skipped: { line: number; name: string; reason: string }[];
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const crewLabel = (p: { rotation: Meal; exempt: boolean }) => (p.exempt ? 'exempt' : `${p.rotation} rotation`);

export function planImport(
  intake: IntakeResult,
  current: CurrentMember[],
  defaults: RosterDefaults,
  options: ImportOptions,
): ImportPlan {
  const byKey = new Map(current.map((m) => [nameKey(m.name), m]));
  const plan: ImportPlan = { add: [], update: [], remove: [], unchanged: 0, skipped: [] };
  const seen = new Set<string>();

  for (const row of intake.rows) {
    const key = nameKey(row.name);

    if (options.liveInOnly && intake.columns.room && !isLiveInRoom(row.room)) {
      plan.skipped.push({ line: row.line, name: row.name, reason: row.room ? `lives out (${row.room})` : 'no room' });
      continue;
    }

    let year: IntakeYear | undefined = row.classYear;
    if (!year && row.pledgeClass) {
      const mapped = options.pledgeYears[row.pledgeClass];
      if (mapped === 'skip') {
        plan.skipped.push({ line: row.line, name: row.name, reason: `${row.pledgeClass} is set to not import` });
        continue;
      }
      year = mapped;
    }

    seen.add(key);
    const existing = byKey.get(key);

    if (!existing) {
      const classYear = year ?? 'other';
      plan.add.push({
        key,
        line: row.line,
        name: row.name,
        classYear,
        yearGuessed: !year,
        room: row.room ?? null,
        pledgeClass: row.pledgeClass ?? null,
        placement: placement(classYear, row.crew, defaults),
      });
      continue;
    }

    const changes: FieldChange[] = [];
    const set: PlanUpdate['set'] = {};
    const note = <K extends keyof PlanUpdate['set']>(field: FieldChange['field'], k: K, from: unknown, to: PlanUpdate['set'][K]) => {
      if (show(from) === show(to)) return;
      changes.push({ field, from: show(from), to: show(to) });
      set[k] = to;
    };

    if (year) note('classYear', 'classYear', existing.classYear, year);
    if (row.room !== undefined) note('room', 'room', existing.room, row.room);
    if (row.pledgeClass !== undefined) note('pledgeClass', 'pledgeClass', existing.pledgeClass, row.pledgeClass);

    if (row.crew || options.resetCrews) {
      const target = placement(year ?? existing.classYear, row.crew, defaults, existing.rotation);
      if (target.exempt !== existing.exempt || (!target.exempt && target.rotation !== existing.rotation)) {
        changes.push({ field: target.exempt !== existing.exempt ? 'exempt' : 'rotation', from: crewLabel(existing), to: crewLabel(target) });
        set.rotation = target.rotation;
        set.exempt = target.exempt;
        set.exemptReason = target.exemptReason;
      }
    }

    if (!existing.active) {
      changes.push({ field: 'active', from: 'off the roster', to: 'on the roster' });
      set.active = true;
    }

    if (changes.length) plan.update.push({ id: existing.id, name: existing.name, line: row.line, changes, set });
    else plan.unchanged++;
  }

  if (options.removeMissing) {
    for (const m of current) {
      if (m.active && !seen.has(nameKey(m.name))) plan.remove.push({ id: m.id, name: m.name });
    }
  }

  return plan;
}
