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

/** The next Sunday strictly after the given date. */
export function nextSunday(iso: string): string {
  const idx = dayIndex(iso); // 6 === Sunday
  return addDays(iso, 7 - idx);
}
