/**
 * The manager's roster operations against the test database: that each one
 * changes what it says, refuses what it should, and leaves an audit row on
 * every member it touched.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, like } from 'drizzle-orm';

import { db } from '../../db/index.ts';
import { members, events, semesters } from '../../db/schema.ts';
import {
  addMember,
  setDuty,
  applyPoints,
  previewPoints,
  setActive,
  deleteMember,
  updateProfile,
  updateOwnProfile,
  previewImport,
  applyImport,
} from '../roster-service.ts';
import { startNextSemester, suggestNextSemester, checkSemester } from '../semester-service.ts';

const ACTOR = 'Test Manager';
const created: string[] = [];

async function get(id: string) {
  const [m] = await db.select().from(members).where(eq(members.id, id));
  return m;
}

async function eventsFor(id: string) {
  return db.select().from(events).where(and(eq(events.entityType, 'member'), eq(events.entityId, id)));
}

async function fresh(name: string, classYear: 'junior' | 'sophomore' | 'senior' = 'junior') {
  const res = await addMember(ACTOR, { name, classYear });
  assert.ok(res.ok, res.message);
  created.push(res.id!);
  return res.id!;
}

after(async () => {
  // Leave the shared test database as the seed made it.
  const byName = await db.select({ id: members.id }).from(members).where(like(members.name, 'Zz %'));
  const ids = [...new Set([...created, ...byName.map((m) => m.id)])];
  if (ids.length) await db.delete(members).where(inArray(members.id, ids));
});

describe('adding and removing people', () => {
  test('a new junior joins the lunch crew level with its lowest score', async () => {
    const [low] = await db
      .select({ p: members.points })
      .from(members)
      .where(and(eq(members.rotation, 'lunch'), eq(members.exempt, false), eq(members.active, true)))
      .orderBy(members.points)
      .limit(1);
    const id = await fresh('Zz Newcomer');
    const m = await get(id);
    assert.equal(m.rotation, 'lunch');
    assert.equal(m.exempt, false);
    assert.equal(m.points, low?.p ?? 0);
    assert.equal((await eventsFor(id))[0].action, 'roster.member_added');
  });

  test('a new senior is exempt', async () => {
    const m = await get(await fresh('Zz Senior Guy', 'senior'));
    assert.equal(m.exempt, true);
    assert.equal(m.exemptReason, 'senior');
  });

  test('the same name twice is refused, whatever the case', async () => {
    await fresh('Zz Twice');
    const res = await addMember(ACTOR, { name: '  zz   TWICE ', classYear: 'junior' });
    assert.equal(res.ok, false);
    assert.match(res.message, /already on the roster/);
  });

  test('off the roster keeps him and signs him out; back on restores him', async () => {
    const id = await fresh('Zz Leaver');
    const before = await get(id);
    assert.ok((await setActive(ACTOR, [id], false)).ok);
    const off = await get(id);
    assert.equal(off.active, false);
    assert.equal(off.sessionVersion, before.sessionVersion + 1);
    assert.ok((await setActive(ACTOR, [id], true)).ok);
    assert.equal((await get(id)).active, true);
  });

  test('delete is for a mistake: works for someone never scheduled', async () => {
    const id = await fresh('Zz Typo');
    assert.ok((await deleteMember(ACTOR, id)).ok);
    assert.equal(await get(id), undefined);
    const [log] = await db.select().from(events).where(eq(events.action, 'roster.member_deleted')).orderBy(events.createdAt);
    assert.match(log.summary, /Zz Typo/);
  });
});

describe('duty', () => {
  test('moving people between crews and exempting them, in bulk', async () => {
    const a = await fresh('Zz Crew A');
    const b = await fresh('Zz Crew B', 'sophomore');

    const moved = await setDuty(ACTOR, [a, b], { kind: 'crew', crew: 'dinner' });
    assert.ok(moved.ok);
    assert.equal((await get(a)).rotation, 'dinner');
    assert.equal((await get(b)).rotation, 'dinner');
    // b was already on dinner, so only a has a crew-change event.
    assert.ok((await eventsFor(a)).some((e) => e.action === 'roster.crew_changed'));
    assert.ok(!(await eventsFor(b)).some((e) => e.action === 'roster.crew_changed'));

    await setDuty(ACTOR, [a], { kind: 'exempt', reason: 'officer', notes: 'Treasurer' });
    const ex = await get(a);
    assert.equal(ex.exempt, true);
    assert.equal(ex.exemptReason, 'officer');
    assert.equal(ex.rotation, 'dinner', 'an exempt brother keeps his crew');

    await setDuty(ACTOR, [a], { kind: 'crew', crew: 'lunch' });
    const back = await get(a);
    assert.equal(back.exempt, false);
    assert.equal(back.exemptNotes, null);
    assert.equal(back.rotation, 'lunch');
  });

  test('a bad reason is refused', async () => {
    const id = await fresh('Zz Bad Reason');
    const res = await setDuty(ACTOR, [id], { kind: 'exempt', reason: 'bored' as never });
    assert.equal(res.ok, false);
  });
});

describe('points', () => {
  test('bulk add to selected people, with a reason on each record', async () => {
    const a = await fresh('Zz Points A');
    const b = await fresh('Zz Points B');
    const pa = (await get(a)).points;

    const res = await applyPoints(ACTOR, 'selected', [a, b], 'add', 1.5, 'Rush week help');
    assert.ok(res.ok, res.message);
    assert.equal((await get(a)).points, pa + 1.5);
    const log = (await eventsFor(a)).find((e) => e.action === 'roster.points_adjusted');
    assert.match(log!.summary, /Rush week help/);
  });

  test('a reason is required, and bad amounts are refused', async () => {
    const id = await fresh('Zz Points C');
    assert.equal((await applyPoints(ACTOR, 'selected', [id], 'add', 1, '  ')).ok, false);
    assert.equal((await applyPoints(ACTOR, 'selected', [id], 'add', 0.3, 'x')).ok, false);
  });

  test('the preview of a crew-wide rebase takes everyone down by the lowest', async () => {
    const preview = await previewPoints('lunch', [], 'rebase', 0);
    assert.ok(preview.ok);
    const lowest = preview.plan!.rebasedBy!;
    for (const c of preview.plan!.changes) assert.equal(c.after, c.before - lowest);
  });
});

describe('profiles', () => {
  test('the manager edits the profile; notes stay out of the log payload', async () => {
    const id = await fresh('Zz Profile');
    const res = await updateProfile(ACTOR, id, {
      name: 'Zz Profile Renamed',
      classYear: 'senior',
      room: '204',
      pledgeClass: 'Alpha Mu',
      slackUserId: 'u01abc23def',
      managerNotes: 'private thing',
    });
    assert.ok(res.ok, res.message);
    const m = await get(id);
    assert.equal(m.name, 'Zz Profile Renamed');
    assert.equal(m.slackUserId, 'U01ABC23DEF');
    assert.equal(m.rotation, 'lunch', 'class year alone never moves his crew');
    const log = (await eventsFor(id)).find((e) => e.action === 'roster.profile_updated')!;
    assert.ok(!JSON.stringify(log.payload).includes('private thing'));
  });

  test('a brother edits his own room and Slack ID, and nothing else', async () => {
    const id = await fresh('Zz Self');
    assert.ok((await updateOwnProfile(id, { room: '305', slackUserId: '' })).ok);
    assert.equal((await get(id)).room, '305');
    const bad = await updateOwnProfile(id, { room: '305', slackUserId: 'not-an-id' });
    assert.equal(bad.ok, false);
  });
});

describe('import', () => {
  const text = 'Name,Year,Room,Crew\nZz Import One,Junior,210,\nZz Import Two,Senior,211,lunch\nZz Import Out,Junior,Live-Out,';
  const options = { pledgeYears: {}, liveInOnly: true, removeMissing: false, resetCrews: false };

  test('preview then apply only what was ticked', async () => {
    const preview = await previewImport(text, options);
    assert.ok(preview.ok, preview.message);
    assert.deepEqual(preview.plan!.add.map((a) => a.name), ['Zz Import One', 'Zz Import Two']);
    assert.equal(preview.plan!.skipped.length, 1);

    const two = preview.plan!.add.find((a) => a.name === 'Zz Import Two')!;
    const res = await applyImport(ACTOR, text, options, { addKeys: [two.key], updateIds: [], removeIds: [] });
    assert.ok(res.ok, res.message);

    const rows = await db.select().from(members).where(like(members.name, 'Zz Import%'));
    assert.deepEqual(rows.map((r) => r.name), ['Zz Import Two']);
    assert.equal(rows[0].rotation, 'lunch');
    assert.equal(rows[0].exempt, false, 'the crew column put this senior on duty');
    assert.equal(rows[0].room, '211');
  });

  test('importing the same file again adds nobody twice', async () => {
    const again = await previewImport(text, options);
    assert.deepEqual(again.plan!.add.map((a) => a.name), ['Zz Import One']);
    assert.equal(again.plan!.unchanged, 1);
  });
});

describe('semesters', () => {
  test('the next semester is suggested from the current one', () => {
    assert.equal(suggestNextSemester({ name: 'Fall 2026', endsOn: '2026-12-12' }).name, 'Spring 2027');
    assert.equal(suggestNextSemester({ name: 'Spring 2027', endsOn: '2027-05-08' }).name, 'Fall 2027');
  });

  test('bad dates and names are refused', () => {
    const current = { name: 'Fall 2026', startsOn: '2026-08-24' };
    assert.match(checkSemester({ name: 'Spring 2027', startsOn: '2027-05-01', endsOn: '2027-01-01' }, current)!, /end after/);
    assert.match(checkSemester({ name: 'Fall 2026', startsOn: '2027-01-11', endsOn: '2027-05-01' }, current)!, /are in/);
    assert.match(checkSemester({ name: 'Old', startsOn: '2026-01-01', endsOn: '2026-05-01' }, current)!, /start after/);
  });

  test('starting the next semester carries settings and points over', async () => {
    const [before] = await db.select().from(semesters).where(eq(semesters.active, true));
    const pointsBefore = await db.select({ id: members.id, p: members.points }).from(members);

    try {
      const res = await startNextSemester(ACTOR, { name: 'Test Spring', startsOn: '2027-01-11', endsOn: '2027-05-01' });
      assert.ok(res.ok, res.message);
      const [now] = await db.select().from(semesters).where(eq(semesters.active, true));
      assert.equal(now.name, 'Test Spring');
      assert.deepEqual(now.mealDays, before.mealDays);
      assert.deepEqual(now.slotSizes, before.slotSizes);
      const pointsAfter = await db.select({ id: members.id, p: members.points }).from(members);
      assert.deepEqual(pointsAfter, pointsBefore);
    } finally {
      await db.delete(semesters).where(eq(semesters.name, 'Test Spring'));
      await db.update(semesters).set({ active: true }).where(eq(semesters.id, before.id));
    }
  });
});
