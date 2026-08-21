/**
 * Importer for the house contact-list CSV export.
 *
 * The chapter roster lists pledge classes (Alpha Kappa, Alpha Mu, ...) rather
 * than class years, and marks residency by room: a numeric "Fall Room" means
 * the brother lives in. Duty is live-ins only, so the room column is what
 * decides who is on the roster at all.
 *
 * Contact columns (phone, email) are deliberately NOT imported. The app has no
 * use for them, and there is no reason to hold 133 people's phone numbers in a
 * database that never reads them.
 */

import type { ClassYear } from './types.ts';

/** Which pledge classes make up each duty year, for the current school year. */
export interface ClassYearMapping {
  junior: string[];
  sophomore: string[];
}

/**
 * 2026-27: two pledge classes per academic year. Alpha Theta and Alpha Iota
 * are seniors and live out, so they never appear on the duty roster.
 */
export const MAPPING_2026_27: ClassYearMapping = {
  junior: ['Alpha Kappa', 'Alpha Lambda'],
  sophomore: ['Alpha Mu', 'Alpha Nu'],
};

export interface ImportedMember {
  name: string;
  classYear: ClassYear;
  pledgeClass: string;
  room: string;
}

export interface ExcludedPerson {
  name: string;
  pledgeClass: string;
  room: string;
  reason: string;
}

export interface CsvImportResult {
  members: ImportedMember[];
  excluded: ExcludedPerson[];
  problems: { row: number; reason: string }[];
  /** Overrides that matched somebody, for confirmation before committing. */
  appliedOverrides: { name: string; from: ClassYear; to: ClassYear }[];
  /**
   * Override names that matched nobody in the file - almost always a typo.
   * Surfaced loudly, because a silently ignored override puts a brother on
   * the wrong meal for the whole semester.
   */
  unmatchedOverrides: string[];
}

export interface ImportOptions {
  mapping?: ClassYearMapping;
  /**
   * Per-person class year, keyed by full name (case-insensitive), for people
   * whose year does not match their pledge class - most often someone who
   * rushed as a sophomore and so is a year older than the rest of his class.
   *
   * This is a convenience for bulk-fixing at import time. The same change can
   * be made per-person on the admin roster page at any point in the semester.
   */
  overrides?: Record<string, ClassYear>;
}

/* ------------------------------------------------------------------ */

/**
 * RFC 4180 parser. Written out rather than pulled from a package because the
 * export contains quoted fields with embedded newlines (brothers with two
 * email addresses), which naive line-splitting silently corrupts.
 */
export function parseCSV(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** A numeric room number means the brother lives in the house. */
export function isLiveIn(room: string): boolean {
  return /^\d+$/.test(room.trim());
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseRosterCsv(
  input: string,
  options: ImportOptions = {},
): CsvImportResult {
  const { mapping = MAPPING_2026_27, overrides = {} } = options;

  const rows = parseCSV(input);
  const members: ImportedMember[] = [];
  const excluded: ExcludedPerson[] = [];
  const problems: { row: number; reason: string }[] = [];
  const appliedOverrides: CsvImportResult['appliedOverrides'] = [];

  const overrideMap = new Map<string, ClassYear>(
    Object.entries(overrides).map(([k, v]) => [k.toLowerCase().trim(), v]),
  );
  const matchedOverrides = new Set<string>();

  const finish = (): CsvImportResult => ({
    members,
    excluded,
    problems,
    appliedOverrides,
    unmatchedOverrides: [...overrideMap.keys()].filter(
      (k) => !matchedOverrides.has(k),
    ),
  });

  if (rows.length === 0) {
    problems.push({ row: 0, reason: 'file is empty' });
    return finish();
  }

  const header = rows[0].map((h) => normalize(h));
  const col = (name: string) => header.indexOf(name);

  const iFirst = col('First Name');
  const iLast = col('Last Name');
  const iClass = col('Class');
  const iRoom = col('Fall Room');

  const missing = [
    iFirst === -1 && 'First Name',
    iLast === -1 && 'Last Name',
    iClass === -1 && 'Class',
    iRoom === -1 && 'Fall Room',
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    problems.push({
      row: 1,
      reason: `missing column(s): ${missing.join(', ')}`,
    });
    return finish();
  }

  const juniorSet = new Set(mapping.junior.map((c) => c.toLowerCase()));
  const sophomoreSet = new Set(mapping.sophomore.map((c) => c.toLowerCase()));
  const seen = new Set<string>();

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2; // 1-indexed, and row 1 is the header
    const name = normalize(`${r[iFirst] ?? ''} ${r[iLast] ?? ''}`);
    const pledgeClass = normalize(r[iClass] ?? '');
    const room = normalize(r[iRoom] ?? '');

    if (!name) {
      problems.push({ row: rowNo, reason: 'no name' });
      return;
    }

    if (seen.has(name.toLowerCase())) {
      problems.push({ row: rowNo, reason: `duplicate name: ${name}` });
      return;
    }
    seen.add(name.toLowerCase());

    if (!isLiveIn(room)) {
      excluded.push({
        name,
        pledgeClass,
        room,
        reason: room ? `not living in (${room})` : 'no room assigned',
      });
      return;
    }

    const key = pledgeClass.toLowerCase();
    let classYear: ClassYear | null = null;
    if (juniorSet.has(key)) classYear = 'junior';
    else if (sophomoreSet.has(key)) classYear = 'sophomore';

    // An explicit override wins over the pledge class, and can also pull in
    // someone whose pledge class is not on the duty roster at all.
    const nameKey = name.toLowerCase();
    const override = overrideMap.get(nameKey);
    if (override) {
      matchedOverrides.add(nameKey);
      if (classYear && classYear !== override) {
        appliedOverrides.push({ name, from: classYear, to: override });
      }
      classYear = override;
    }

    if (!classYear) {
      excluded.push({
        name,
        pledgeClass,
        room,
        reason: pledgeClass
          ? `pledge class "${pledgeClass}" is not on the duty roster`
          : 'no pledge class',
      });
      return;
    }

    members.push({ name, classYear, pledgeClass, room });
  });

  return finish();
}
