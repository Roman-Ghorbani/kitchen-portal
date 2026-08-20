/**
 * Forgiving roster parser.
 *
 * Roman's roster could arrive as a spreadsheet paste, a Slack message, or a
 * list someone typed by hand. Rather than demand a format, this accepts the
 * shapes a real chapter roster actually shows up in and reports what it could
 * not make sense of, so nothing is silently dropped.
 *
 * Supported shapes (mixable in one paste):
 *
 *   Jake Meyerson, Junior          <- delimited pairs (comma/tab/pipe/semicolon)
 *   Ben Cohen  Sophomore
 *   Aaron Katz (Jr)                <- year in parentheses
 *   Sam Feldman - soph
 *
 *   Juniors:                       <- section headings, names inherit the year
 *     Noah Berger
 *     Eli Wolf
 *
 *   Sophomores                     <- heading without a colon also works
 *   Josh Adler
 *   Tyler Gross
 */

import type { ClassYear } from './types.ts';

export interface ParsedMember {
  name: string;
  classYear: ClassYear;
  /** Line number in the original paste, for error reporting. */
  line: number;
}

export interface ParseProblem {
  line: number;
  text: string;
  reason: string;
}

export interface RosterParseResult {
  members: ParsedMember[];
  problems: ParseProblem[];
  duplicates: ParsedMember[];
}

const JUNIOR_WORDS = new Set([
  'junior',
  'juniors',
  'jr',
  'jrs',
  'j',
  '3',
  '3rd',
  'third',
]);

const SOPHOMORE_WORDS = new Set([
  'sophomore',
  'sophomores',
  'soph',
  'sophs',
  'so',
  'sop',
  'so.',
  '2',
  '2nd',
  'second',
]);

function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[()[\]{}.,;:!-]/g, '')
    .trim();
}

function readYear(token: string): ClassYear | null {
  const t = normalizeToken(token);
  if (JUNIOR_WORDS.has(t)) return 'junior';
  if (SOPHOMORE_WORDS.has(t)) return 'sophomore';
  return null;
}

/**
 * A heading is a line that is nothing but a class-year word, optionally with
 * a trailing colon - "Juniors:", "SOPHOMORES", "Jr".
 */
function readHeading(line: string): ClassYear | null {
  const stripped = line.replace(/:$/, '').trim();
  if (stripped.split(/\s+/).length > 1) return null;
  return readYear(stripped);
}

/** Names are Title Case-ish and contain no digits. Guards against junk rows. */
function looksLikeName(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/\d/.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  return true;
}

function cleanName(s: string): string {
  return s
    .replace(/^[\s\-*•\d.)]+/, '') // bullets, numbering
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRoster(input: string): RosterParseResult {
  const members: ParsedMember[] = [];
  const problems: ParseProblem[] = [];
  const duplicates: ParsedMember[] = [];
  const seen = new Map<string, ParsedMember>();

  let sectionYear: ClassYear | null = null;

  const lines = input.split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (!line) return;

    // Skip spreadsheet header rows.
    if (/^(name|full name|member|brother)\b/i.test(line) && /year|class/i.test(line)) {
      return;
    }

    const heading = readHeading(line);
    if (heading) {
      sectionYear = heading;
      return;
    }

    // "Juniors: Noah Berger, Eli Wolf" - heading and names on one line.
    const inlineHeading = line.match(/^([A-Za-z.]+)\s*:\s*(.+)$/);
    if (inlineHeading && readYear(inlineHeading[1])) {
      const year = readYear(inlineHeading[1])!;
      sectionYear = year;
      for (const piece of inlineHeading[2].split(/[,;|]/)) {
        const name = cleanName(piece);
        if (!name) continue;
        if (looksLikeName(name)) {
          record(name, year, lineNo);
        } else {
          problems.push({ line: lineNo, text: piece.trim(), reason: 'not a name' });
        }
      }
      return;
    }

    // Delimited "Name <sep> Year", trying explicit separators before whitespace.
    let name: string | null = null;
    let year: ClassYear | null = null;

    const parts = line.split(/\s*[,;|\t]\s*|\s+-\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const tail = readYear(parts[parts.length - 1]);
      if (tail) {
        year = tail;
        name = cleanName(parts.slice(0, -1).join(' '));
      }
    }

    // "Aaron Katz (Jr)" or "Aaron Katz Jr" - year as the trailing word.
    if (!year) {
      const words = line.split(/\s+/);
      if (words.length >= 2) {
        const tail = readYear(words[words.length - 1]);
        if (tail) {
          year = tail;
          name = cleanName(words.slice(0, -1).join(' '));
        }
      }
    }

    // Bare name under a section heading.
    if (!year && sectionYear) {
      const candidate = cleanName(line);
      if (looksLikeName(candidate)) {
        record(candidate, sectionYear, lineNo);
        return;
      }
    }

    if (year && name && looksLikeName(name)) {
      record(name, year, lineNo);
      return;
    }

    problems.push({
      line: lineNo,
      text: line,
      reason: sectionYear
        ? 'could not read a name'
        : 'no class year on this line, and no section heading above it',
    });
  });

  function record(name: string, classYear: ClassYear, line: number) {
    const key = name.toLowerCase();
    const entry: ParsedMember = { name, classYear, line };
    const prior = seen.get(key);
    if (prior) {
      duplicates.push(entry);
      return;
    }
    seen.set(key, entry);
    members.push(entry);
  }

  return { members, problems, duplicates };
}
