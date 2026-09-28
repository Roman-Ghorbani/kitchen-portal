/**
 * Moving the house on to the next semester.
 *
 * What carries over: the roster, everyone's points and make-up debt (points
 * are how the draw stays fair across a brother's whole time in the house),
 * which days the house serves, crew sizes, and the late-plate settings.
 *
 * What starts fresh: standing conflicts, because class schedules change, and
 * the weeks - the old semester's weeks stay in the record, read-only.
 */

import { eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { semesters, events } from '../db/schema.ts';
import { addDays, mondayOf } from './dates.ts';

export interface SemesterInput {
  name: string;
  startsOn: string;
  endsOn: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "Fall 2026" → "Spring 2027"; "Spring 2027" → "Fall 2027". */
export function suggestNextSemester(current: { name: string; endsOn: string }): SemesterInput {
  const m = /^(Fall|Spring|Summer)\s+(\d{4})$/i.exec(current.name.trim());
  let name = '';
  if (m) {
    const year = Number(m[2]);
    name = m[1].toLowerCase() === 'fall' ? `Spring ${year + 1}` : `Fall ${year}`;
  }
  // The Monday after the old term ends, give or take; the manager adjusts it.
  const startsOn = mondayOf(addDays(current.endsOn, 7));
  const isSpring = name.startsWith('Spring');
  const endsOn = addDays(startsOn, isSpring ? 7 * 17 - 3 : 7 * 16 - 3);
  return { name, startsOn, endsOn };
}

export function checkSemester(input: SemesterInput, current?: { name: string; startsOn: string }): string | null {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 40) return 'Give the semester a name, like “Spring 2027”.';
  if (!ISO.test(input.startsOn) || !ISO.test(input.endsOn)) return 'Enter both dates.';
  if (input.endsOn <= input.startsOn) return 'The semester has to end after it starts.';
  if (current && name.toLowerCase() === current.name.toLowerCase()) return `${current.name} is the semester you are in.`;
  if (current && input.startsOn <= current.startsOn) return `It has to start after ${current.name} did.`;
  return null;
}

/**
 * Creates the next semester and makes it the active one. The previous one is
 * kept, inactive, with every week and assignment it had.
 */
export async function startNextSemester(
  actor: string,
  input: SemesterInput,
): Promise<{ ok: boolean; message: string }> {
  const [current] = await db.select().from(semesters).where(eq(semesters.active, true)).limit(1);
  const problem = checkSemester(input, current);
  if (problem) return { ok: false, message: problem };

  const clash = await db.select({ id: semesters.id }).from(semesters).where(eq(semesters.name, input.name.trim()));
  if (clash.length) return { ok: false, message: `There is already a semester called ${input.name.trim()}.` };

  db.transaction((tx) => {
    if (current) tx.update(semesters).set({ active: false }).where(eq(semesters.id, current.id)).run();
    const [row] = tx
      .insert(semesters)
      .values({
        name: input.name.trim(),
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        active: true,
        mealDays: current?.mealDays ?? { lunch: Array(7).fill(true), dinner: Array(7).fill(true) },
        slotSizes: current?.slotSizes ?? { lunch: 2, dinner: 3 },
        latePlatesEnabled: current?.latePlatesEnabled ?? true,
        latePlateDays: current?.latePlateDays ?? null,
        latePlateMessage: null,
      })
      .returning({ id: semesters.id })
      .all();
    tx.insert(events)
      .values({
        action: 'settings.semester_started',
        entityType: 'semester',
        entityId: row.id,
        actorRole: 'manager',
        actorName: actor,
        summary:
          `${actor} started ${input.name.trim()} (${input.startsOn} → ${input.endsOn})` +
          (current ? `; ${current.name} is closed, points carried over` : ''),
        payload: { previous: current?.id ?? null },
      })
      .run();
  });

  return {
    ok: true,
    message:
      `${input.name.trim()} has started. Points and the roster carried over. ` +
      'Brothers need to re-enter their standing conflicts for the new class schedule.',
  };
}
