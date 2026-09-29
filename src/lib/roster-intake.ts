/**
 * Reading a roster from whatever the chapter hands you.
 *
 * Pure and dependency-free, so it runs in the browser for an instant preview
 * and on the server when the import is applied. Two shapes are understood:
 *
 *  1. A table - the chapter's contact export, a spreadsheet saved as CSV, or
 *     cells copied straight out of Sheets or Excel (tab-separated). Columns are
 *     found by their header, in any order, under any of the usual names:
 *
 *       name | full name | first name + last name
 *       year | class year | grade | standing
 *       pledge class | class          ("Class" is read as a year if its values
 *                                      look like years, otherwise as pledge class)
 *       room | fall room | spring room
 *       crew | duty | meal | rotation  (lunch, dinner, or exempt)
 *
 *     Anything else - phone, email, major - is ignored and never stored.
 *
 *  2. A plain list, one person per line, typed or pasted from a message:
 *
 *       Jake Meyerson, Junior         Aaron Katz (Jr)
 *       Juniors:                      Seniors
 *         Noah Berger                 Ben Cohen - lunch
 *
 * Nothing is dropped silently: every line that could not be read comes back
 * as a problem with its line number and text.
 */

export type IntakeYear = 'freshman' | 'sophomore' | 'junior' | 'senior' | 'fifth-year' | 'other';
export type IntakeCrew = 'lunch' | 'dinner' | 'exempt';

export interface IntakeRow {
  /** 1-based line (or table row) in the original input. */
  line: number;
  name: string;
  classYear?: IntakeYear;
  pledgeClass?: string;
  room?: string;
  crew?: IntakeCrew;
}

export interface IntakeProblem {
  line: number;
  text: string;
  reason: string;
}

export interface IntakeResult {
  format: 'table' | 'list';
  rows: IntakeRow[];
  problems: IntakeProblem[];
  /** Which optional columns the table had; drives what the preview offers. */
  columns: { classYear: boolean; pledgeClass: boolean; room: boolean; crew: boolean };
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const YEAR_WORDS: Record<string, IntakeYear> = {};
for (const [year, words] of Object.entries({
  freshman: ['freshman', 'freshmen', 'fr', 'frosh', 'first year', '1st year', '1'],
  sophomore: ['sophomore', 'sophomores', 'soph', 'sophs', 'so', '2nd year', 'second year', '2'],
  junior: ['junior', 'juniors', 'jr', 'jrs', '3rd year', 'third year', '3'],
  senior: ['senior', 'seniors', 'sr', 'srs', '4th year', 'fourth year', '4'],
  'fifth-year': ['fifth year', 'fifth-year', '5th year', 'super senior', '5'],
}) as [IntakeYear, string[]][]) {
  for (const w of words) YEAR_WORDS[w] = year;
}

const CREW_WORDS: Record<string, IntakeCrew> = {
  lunch: 'lunch', l: 'lunch', 'lunch crew': 'lunch', 'lunch rotation': 'lunch',
  dinner: 'dinner', d: 'dinner', 'dinner crew': 'dinner', 'dinner rotation': 'dinner',
  exempt: 'exempt', none: 'exempt', off: 'exempt', 'not on duty': 'exempt', 'n/a': 'exempt',
};

const clean = (s: string) => s.toLowerCase().replace(/[()[\]{}.:;!]/g, '').replace(/\s+/g, ' ').trim();

export function readYear(token: string): IntakeYear | null {
  return YEAR_WORDS[clean(token)] ?? null;
}

export function readCrew(token: string): IntakeCrew | null {
  return CREW_WORDS[clean(token)] ?? null;
}

/** "3", "212", "3B" - anything that starts with a digit is a room in the house. */
export function isLiveInRoom(room: string | undefined): boolean {
  return Boolean(room && /^\d/.test(room.trim()));
}

export function normaliseName(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** For matching people across imports: case, spacing and punctuation-insensitive. */
export function nameKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeName(s: string): boolean {
  const t = s.trim();
  return t.length >= 2 && t.length <= 80 && !/\d/.test(t) && /[A-Za-z]/.test(t);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * RFC 4180, including quoted fields with embedded newlines and commas - the
 * chapter export has both. Tab-separated input (a paste from a spreadsheet)
 * is handled by passing '\t'.
 */
export function parseDelimited(input: string, sep = ','): string[][] {
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
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/* ------------------------------------------------------------------ */
/* Table mode                                                          */
/* ------------------------------------------------------------------ */

const HEADERS = {
  name: ['name', 'full name', 'member', 'brother', 'member name'],
  first: ['first name', 'first', 'firstname', 'given name'],
  last: ['last name', 'last', 'lastname', 'surname', 'family name'],
  year: ['year', 'class year', 'grade', 'standing', 'academic year', 'school year'],
  pledge: ['pledge class', 'pledgeclass', 'pledge', 'class'],
  room: ['room', 'room number', 'fall room', 'spring room', 'room #'],
  crew: ['crew', 'duty', 'meal', 'rotation', 'duty crew'],
} as const;

function findHeader(header: string[]) {
  const norm = header.map(clean);
  const find = (names: readonly string[]) => norm.findIndex((h) => names.includes(h));
  return {
    name: find(HEADERS.name),
    first: find(HEADERS.first),
    last: find(HEADERS.last),
    year: find(HEADERS.year),
    pledge: find(HEADERS.pledge),
    room: find(HEADERS.room),
    crew: find(HEADERS.crew),
  };
}

function readTable(input: string): IntakeResult | null {
  const firstLine = input.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const sep = firstLine.includes('\t') ? '\t' : ',';
  if (!firstLine.includes(sep)) return null;

  const table = parseDelimited(input, sep);
  if (table.length < 1) return null;
  const col = findHeader(table[0]);
  const hasName = col.name >= 0 || (col.first >= 0 && col.last >= 0);
  if (!hasName) return null;

  // "Class" is ambiguous: the chapter export uses it for the pledge class, a
  // hand-made sheet for the year. Decide from what is in it.
  let yearCol = col.year;
  let pledgeCol = col.pledge;
  if (yearCol < 0 && pledgeCol >= 0) {
    const values = table.slice(1).map((r) => r[pledgeCol] ?? '').filter((v) => v.trim());
    const asYears = values.filter((v) => readYear(v)).length;
    if (values.length > 0 && asYears / values.length >= 0.6) {
      yearCol = pledgeCol;
      pledgeCol = -1;
    }
  }

  const rows: IntakeRow[] = [];
  const problems: IntakeProblem[] = [];
  const seen = new Set<string>();

  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (c: number) => (c >= 0 ? normaliseName(r[c] ?? '') : '');
    const name = col.name >= 0 ? cell(col.name) : normaliseName(`${cell(col.first)} ${cell(col.last)}`);
    const text = r.join(sep === '\t' ? '  ' : ', ');

    if (!name) return problems.push({ line, text, reason: 'no name' });
    if (!looksLikeName(name)) return problems.push({ line, text, reason: 'not a name' });
    if (seen.has(nameKey(name))) return problems.push({ line, text, reason: `${name} appears twice` });
    seen.add(nameKey(name));

    const row: IntakeRow = { line, name };
    if (yearCol >= 0 && cell(yearCol)) {
      const y = readYear(cell(yearCol));
      if (y) row.classYear = y;
      else problems.push({ line, text, reason: `"${cell(yearCol)}" is not a class year - left blank` });
    }
    if (pledgeCol >= 0 && cell(pledgeCol)) row.pledgeClass = cell(pledgeCol);
    if (col.room >= 0 && cell(col.room)) row.room = cell(col.room);
    if (col.crew >= 0 && cell(col.crew)) {
      const c = readCrew(cell(col.crew));
      if (c) row.crew = c;
      else problems.push({ line, text, reason: `"${cell(col.crew)}" is not lunch, dinner or exempt - left to the default` });
    }
    rows.push(row);
  });

  return {
    format: 'table',
    rows,
    problems,
    columns: { classYear: yearCol >= 0, pledgeClass: pledgeCol >= 0, room: col.room >= 0, crew: col.crew >= 0 },
  };
}

/* ------------------------------------------------------------------ */
/* List mode                                                           */
/* ------------------------------------------------------------------ */

function stripBullet(s: string): string {
  return s.replace(/^[\s\-*•\d.)]+(?=[A-Za-z])/, '').replace(/\s+/g, ' ').trim();
}

/** Splits "Name <sep> tag <sep> tag" and reads trailing year/crew tags. */
function readTagged(line: string): { name: string; year?: IntakeYear; crew?: IntakeCrew } | null {
  let rest = line;
  let year: IntakeYear | undefined;
  let crew: IntakeCrew | undefined;

  // Parenthesised tags anywhere: "Aaron Katz (Jr)", "Ben Cohen (lunch)".
  rest = rest.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const y = readYear(inner);
    const c = readCrew(inner);
    if (y && !year) year = y;
    else if (c && !crew) crew = c;
    return ' ';
  });

  // Delimited tail tags: "Name, Junior, lunch" / "Name - soph" / "Name\tSenior".
  let parts = rest.split(/\s*[,;|\t]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1) {
    const tail = parts[parts.length - 1];
    const y = readYear(tail);
    const c = readCrew(tail);
    if (y && !year) year = y;
    else if (c && !crew) crew = c;
    else break;
    parts = parts.slice(0, -1);
  }
  rest = parts.join(' ');

  // Bare trailing words: "Aaron Katz Jr", "Sam Feldman soph dinner".
  // Two-word tags ("fifth year", "lunch crew") are tried before one-word ones.
  let words = rest.split(/\s+/);
  while (words.length > 2) {
    let took = false;
    for (const n of [2, 1]) {
      if (words.length - n < 2) continue;
      const tail = words.slice(-n).join(' ');
      const y = readYear(tail);
      const c = readCrew(tail);
      if (y && !year) year = y;
      else if (c && !crew) crew = c;
      else continue;
      words = words.slice(0, -n);
      took = true;
      break;
    }
    if (!took) break;
  }

  const name = stripBullet(words.join(' '));
  return looksLikeName(name) ? { name, year, crew } : null;
}

function readList(input: string): IntakeResult {
  const rows: IntakeRow[] = [];
  const problems: IntakeProblem[] = [];
  const seen = new Set<string>();
  let sectionYear: IntakeYear | undefined;
  let sectionCrew: IntakeCrew | undefined;

  const add = (line: number, text: string, name: string, year?: IntakeYear, crew?: IntakeCrew) => {
    if (seen.has(nameKey(name))) {
      problems.push({ line, text, reason: `${name} appears twice` });
      return;
    }
    seen.add(nameKey(name));
    const row: IntakeRow = { line, name };
    if (year ?? sectionYear) row.classYear = year ?? sectionYear;
    if (crew ?? sectionCrew) row.crew = crew ?? sectionCrew;
    rows.push(row);
  };

  input.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();
    if (!text) return;

    // A heading on its own: "Juniors:", "SENIORS", "Lunch crew".
    const heading = text.replace(/:$/, '').trim();
    if (readYear(heading) && heading.split(/\s+/).length <= 3) {
      sectionYear = readYear(heading)!;
      sectionCrew = undefined;
      return;
    }
    if (readCrew(heading) && heading.split(/\s+/).length <= 2) {
      sectionCrew = readCrew(heading)!;
      return;
    }

    // A heading with names on the same line: "Juniors: Noah Berger, Eli Wolf".
    const inline = text.match(/^([A-Za-z .]+?)\s*:\s*(.+)$/);
    if (inline && (readYear(inline[1]) || readCrew(inline[1]))) {
      const year = readYear(inline[1]) ?? undefined;
      const crew = readCrew(inline[1]) ?? undefined;
      if (year) sectionYear = year;
      if (crew) sectionCrew = crew;
      for (const piece of inline[2].split(/[,;|]/)) {
        const name = stripBullet(piece);
        if (!name) continue;
        if (looksLikeName(name)) add(line, text, name, year, crew);
        else problems.push({ line, text: piece.trim(), reason: 'not a name' });
      }
      return;
    }

    const parsed = readTagged(text);
    if (parsed) add(line, text, parsed.name, parsed.year, parsed.crew);
    else problems.push({ line, text, reason: 'could not read a name' });
  });

  return {
    format: 'list',
    rows,
    problems,
    columns: {
      classYear: rows.some((r) => r.classYear),
      pledgeClass: false,
      room: false,
      crew: rows.some((r) => r.crew),
    },
  };
}

/* ------------------------------------------------------------------ */

export function readRoster(input: string): IntakeResult {
  const trimmed = input.replace(/^﻿/, '');
  const table = readTable(trimmed);
  if (table) return table;
  return readList(trimmed);
}

/** Distinct pledge classes in a result, for the mapping step. */
export function pledgeClassesIn(result: IntakeResult): string[] {
  const set = new Set<string>();
  for (const r of result.rows) if (r.pledgeClass && !r.classYear) set.add(r.pledgeClass);
  return [...set].sort((a, b) => a.localeCompare(b));
}
