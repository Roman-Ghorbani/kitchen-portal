/**
 * Recomputes every member's points and make-up debt from their assignments.
 *
 * Assignments are the authority: each row records exactly what it awarded and
 * to whom. Member totals are a running sum kept for fast scheduling, and a
 * running sum can drift - a bad migration, an interrupted write, a script that
 * blanked an award without handing the point back.
 *
 * Dry run by default. Pass --commit to write the corrections.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/reconcile-points.ts [--commit]
 */

import { eq } from 'drizzle-orm';

import { db } from '../src/db/index.ts';
import {
  members,
  slots as slotsTable,
  assignments as assignmentsTable,
  events,
} from '../src/db/schema.ts';

async function main() {
  const commit = process.argv.includes('--commit');

  const roster = await db.select().from(members);
  const asg = await db.select().from(assignmentsTable);
  const slots = await db.select().from(slotsTable);
  const slotDate = new Map(slots.map((s) => [s.id, s.date]));

  const expectedPoints = new Map<string, number>();
  const expectedDebt = new Map<string, number>();
  const expectedLast = new Map<string, string>();

  for (const a of asg) {
    if (a.settledRecipientId && a.pointsAwarded !== 0) {
      expectedPoints.set(
        a.settledRecipientId,
        (expectedPoints.get(a.settledRecipientId) ?? 0) + a.pointsAwarded,
      );
      const d = slotDate.get(a.slotId);
      if (d) {
        const prev = expectedLast.get(a.settledRecipientId);
        if (!prev || d > prev) expectedLast.set(a.settledRecipientId, d);
      }
    }
    if (a.debtAwarded !== 0) {
      expectedDebt.set(
        a.memberId,
        (expectedDebt.get(a.memberId) ?? 0) + a.debtAwarded,
      );
    }
  }

  const drift: {
    id: string;
    name: string;
    field: string;
    was: unknown;
    shouldBe: unknown;
  }[] = [];

  for (const m of roster) {
    const p = expectedPoints.get(m.id) ?? 0;
    const d = expectedDebt.get(m.id) ?? 0;
    const l = expectedLast.get(m.id) ?? null;

    if (m.points !== p) {
      drift.push({ id: m.id, name: m.name, field: 'points', was: m.points, shouldBe: p });
    }
    if (m.makeupDebt !== d) {
      drift.push({
        id: m.id,
        name: m.name,
        field: 'makeupDebt',
        was: m.makeupDebt,
        shouldBe: d,
      });
    }
    if (m.lastServedDate !== l) {
      drift.push({
        id: m.id,
        name: m.name,
        field: 'lastServedDate',
        was: m.lastServedDate,
        shouldBe: l,
      });
    }
  }

  const memberTotal = roster.reduce((n, m) => n + m.points, 0);
  const assignmentTotal = asg.reduce((n, a) => n + a.pointsAwarded, 0);

  console.log(`members:            ${roster.length}`);
  console.log(`assignments:        ${asg.length}`);
  console.log(`points on members:  ${memberTotal}`);
  console.log(`points on shifts:   ${assignmentTotal}`);
  console.log(`difference:         ${memberTotal - assignmentTotal}`);
  console.log(`fields out of sync: ${drift.length}`);

  for (const d of drift) {
    console.log(`  ${d.name}: ${d.field} ${d.was} -> ${d.shouldBe}`);
  }

  if (drift.length === 0) {
    console.log('\nnothing to fix.');
    process.exit(0);
  }

  if (!commit) {
    console.log('\ndry run - nothing written. Pass --commit to apply.');
    process.exit(0);
  }

  const touched = new Set(drift.map((d) => d.id));
  for (const id of touched) {
    await db
      .update(members)
      .set({
        points: expectedPoints.get(id) ?? 0,
        makeupDebt: expectedDebt.get(id) ?? 0,
        lastServedDate: expectedLast.get(id) ?? null,
      })
      .where(eq(members.id, id));
  }

  await db.insert(events).values({
    action: 'points.reconciled',
    entityType: 'roster',
    actorName: 'reconcile script',
    actorRole: 'system',
    summary: `Recomputed points from assignments for ${touched.size} member(s)`,
    payload: { corrections: drift },
  });

  console.log(`\ncorrected ${touched.size} member(s) and logged it.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('reconcile failed:', e);
  process.exit(1);
});
