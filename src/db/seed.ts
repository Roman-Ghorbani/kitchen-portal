/**
 * Seeds the active semester, and optionally a demo roster for development.
 *
 * Idempotent - safe to re-run. Never touches real member rows unless you pass
 * --demo, which is refused once real members exist.
 *
 *   node --env-file=.env.local --experimental-strip-types src/db/seed.ts
 *   node --env-file=.env.local --experimental-strip-types src/db/seed.ts --demo
 */

import { eq } from 'drizzle-orm';

import { db } from './index.ts';
import { semesters, members } from './schema.ts';
import { DEFAULT_MEAL_DAYS, DEFAULT_SLOT_SIZES } from '../lib/types.ts';

const FALL_2026 = {
  name: 'Fall 2026',
  startsOn: '2026-08-24',
  endsOn: '2026-12-12',
};

async function seedSemester() {
  const existing = await db
    .select()
    .from(semesters)
    .where(eq(semesters.name, FALL_2026.name));

  if (existing.length > 0) {
    console.log(`semester "${FALL_2026.name}" already exists - leaving it alone`);
    return existing[0];
  }

  const [row] = await db
    .insert(semesters)
    .values({
      ...FALL_2026,
      active: true,
      mealDays: DEFAULT_MEAL_DAYS,
      slotSizes: DEFAULT_SLOT_SIZES,
    })
    .returning();

  const serviceDays = DEFAULT_MEAL_DAYS.lunch.filter(Boolean).length;
  console.log(
    `created semester "${row.name}" (${row.startsOn} to ${row.endsOn}), ` +
      `${serviceDays} service days/week`,
  );
  return row;
}

/* ------------------------------------------------------------------ */

const DEMO_JUNIORS = [
  'Jake Meyerson', 'Aaron Katz', 'Sam Feldman', 'Noah Berger', 'Eli Wolf',
  'Nathan Fine', 'Ryan Stein', 'Adam Hirsch', 'Zach Lieber', 'Ari Goldman',
  'Seth Rubin', 'Ian Perlman', 'Owen Schatz', 'Micah Stern', 'Reid Kaufman',
  'Dov Salzman', 'Levi Brandt', 'Asher Pollak', 'Gideon Marx', 'Ezra Lang',
  'Simon Roth', 'Toby Elkin', 'Wes Sable', 'Yosef Kahn', 'Abe Sonnen',
  'Boaz Winter', 'Caleb Reiss', 'Dean Farber',
];

const DEMO_SOPHOMORES = [
  'Ben Cohen', 'Ethan Rosen', 'Max Weiss', 'Josh Adler', 'Danny Kaplan',
  'Tyler Gross', 'Cole Bernstein', 'Miles Sacks', 'Jonah Reiter', 'Leo Abrams',
  'Isaac Blum', 'Nate Sherman', 'Aiden Kessler', 'Grant Lowen', 'Hugo Mandel',
  'Jared Korn', 'Kyle Bauer', 'Liam Ostrow', 'Milo Frank', 'Noam Hertz',
  'Oren Diamond', 'Paul Ganz', 'Quinn Sable', 'Rafi Melton', 'Sol Bregman',
  'Theo Nussbaum', 'Uri Landau', 'Victor Hess', 'Will Baruch', 'Xavi Doran',
];

async function seedDemoRoster() {
  const existing = await db.select().from(members);
  if (existing.length > 0) {
    console.log(
      `refusing to seed demo data - ${existing.length} members already exist`,
    );
    return;
  }

  const rows = [
    ...DEMO_JUNIORS.map((name) => ({ name, classYear: 'junior' as const })),
    ...DEMO_SOPHOMORES.map((name) => ({ name, classYear: 'sophomore' as const })),
  ];

  await db.insert(members).values(rows);
  console.log(
    `seeded ${DEMO_JUNIORS.length} juniors and ${DEMO_SOPHOMORES.length} ` +
      `sophomores (demo data - delete before going live)`,
  );
}

/* ------------------------------------------------------------------ */

async function main() {
  await seedSemester();

  if (process.argv.includes('--demo')) {
    await seedDemoRoster();
  }

  const roster = await db.select().from(members);
  const juniors = roster.filter((m) => m.classYear === 'junior').length;
  console.log(
    `roster size: ${roster.length} (${juniors} juniors, ` +
      `${roster.length - juniors} sophomores)`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('seed failed:', err.message);
    process.exit(1);
  },
);
