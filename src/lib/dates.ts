/**
 * Date helpers. Everything is an ISO YYYY-MM-DD string handled in UTC so the
 * schedule never shifts under a user in a different timezone, and so lock
 * deadlines are anchored server-side rather than to a phone's clock.
 */

import type { DayIndex } from './types.ts';

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Formats a Date or timestamp into human-readable US Eastern Time (America/New_York).
 * e.g. "Aug 23, 9:23 PM"
 */
export function formatEasternTimestamp(
  d: Date | number | string | null,
  includeYear: boolean = false,
): string {
  if (!d) return '—';
  const date = typeof d === 'number' || typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Returns today's ISO date string (YYYY-MM-DD) in US Eastern Time (America/New_York).
 * The ZBT house is in Eastern Time, so calendar days roll over at Eastern midnight.
 */
export function todayInEastern(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** 0 = Monday ... 6 = Sunday. */
export function dayIndex(iso: string): DayIndex {
  return ((parseISO(iso).getUTCDay() + 6) % 7) as DayIndex;
}

/** The Monday on or before the given date. */
export function mondayOf(iso: string): string {
  return addDays(iso, -dayIndex(iso));
}

/** The seven ISO dates of the Mon-Sun week starting at weekStart. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  return Math.round(
    (parseISO(toISOStr).getTime() - parseISO(fromISO).getTime()) / 86_400_000,
  );
}

/**
 * The week that gets posted at the Sunday chapter on `chapterDate`.
 *
 * House rule: the week posted at chapter starts 8 days later, guaranteeing a
 * full 7-day window between posting and go-live so nobody is surprised.
 */
export function weekPostedAtChapter(chapterDate: string): string {
  return addDays(chapterDate, 8);
}

/**
 * The next Sunday strictly after the given date.
 *
 * Note the day indices run Mon=0..Sun=6, so the distance to Sunday is
 * (6 - idx), except from a Sunday itself where "strictly after" means +7.
 */
export function nextSunday(iso: string): string {
  const idx = dayIndex(iso);
  return addDays(iso, idx === 6 ? 7 : 6 - idx);
}

/**
 * The Sunday chapter at which a week locks: the one immediately before it
 * starts. Weeks run Mon-Sun, so that is simply the day before the week begins.
 *
 * This holds for both the normal cadence and the bootstrap week. Under the
 * normal cadence a week is posted at chapter and starts 8 days later, so it
 * locks at the following chapter - exactly 7 days of open flagging. The
 * bootstrap week is posted late and so gets a shorter window, but it still
 * closes at the same point: before the week runs, never after.
 */
export function chapterLockFor(weekStart: string): string {
  return addDays(weekStart, -1);
}

/** The most recent Sunday chapter on or before the given date. */
export function lastChapterOnOrBefore(iso: string): string {
  const idx = dayIndex(iso);
  return idx === 6 ? iso : addDays(iso, -(idx + 1));
}

/**
 * The week the cadence says should be posted as of the given date - i.e. the
 * one that the most recent chapter would have posted.
 *
 * Driven by the calendar rather than by what already exists, so running the
 * transition twice in one day cannot post weeks arbitrarily far ahead.
 */
export function weekDueForPosting(today: string): string {
  return weekPostedAtChapter(lastChapterOnOrBefore(today));
}
