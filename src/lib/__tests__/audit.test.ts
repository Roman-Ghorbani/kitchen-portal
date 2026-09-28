/**
 * The audit log's query layer: every filter the manager's page exposes, run
 * against real rows in the test database.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../../db/index.ts';
import { members } from '../../db/schema.ts';
import { logEvent, queryAudit, exportAudit, toCsv, auditFacets } from '../audit.ts';

const TAG = `audit-test-${Date.now()}`;
let alice: { id: string; name: string };

before(async () => {
  [alice] = await db.select({ id: members.id, name: members.name }).from(members).limit(1);

  await logEvent({
    action: 'shift.flagged',
    entityType: 'assignment',
    entityId: 'asg-1',
    actorRole: 'brother',
    actorMemberId: alice.id,
    actorName: alice.name,
    summary: `${TAG} ${alice.name} put his shift up for grabs`,
  });
  await logEvent({
    action: 'auth.signin_failed',
    entityType: 'member',
    entityId: alice.id,
    actorRole: 'anonymous',
    summary: `${TAG} failed PIN`,
    payload: { ip: '203.0.113.9' },
  });
  await logEvent({
    action: 'roster.points_adjusted',
    entityType: 'member',
    entityId: alice.id,
    actorRole: 'manager',
    actorName: 'Kitchen Manager',
    summary: `${TAG} =HYPERLINK("http://evil") points 100%_off`,
  });
});

describe('queryAudit', () => {
  test('free text searches summary and payload', async () => {
    assert.equal((await queryAudit({ q: TAG })).total, 3);
    const byIp = await queryAudit({ q: '203.0.113.9' });
    assert.ok(byIp.rows.some((r) => r.action === 'auth.signin_failed'));
  });

  test('LIKE wildcards in the search box are literal', async () => {
    assert.equal((await queryAudit({ q: `${TAG} %` })).total, 0);
    assert.equal((await queryAudit({ q: '100%_off' })).total, 1);
  });

  test('categories match the action family', async () => {
    const r = await queryAudit({ q: TAG, categories: ['auth', 'roster'] });
    assert.deepEqual(r.rows.map((x) => x.action).sort(), ['auth.signin_failed', 'roster.points_adjusted']);
  });

  test('exact action and actor role filters combine', async () => {
    assert.equal((await queryAudit({ q: TAG, actions: ['shift.flagged'] })).total, 1);
    assert.equal((await queryAudit({ q: TAG, roles: ['manager', 'anonymous'] })).total, 2);
    assert.equal((await queryAudit({ q: TAG, roles: ['kiosk'] })).total, 0);
  });

  test('a member filter finds what he did and what was done to him', async () => {
    const r = await queryAudit({ q: TAG, memberId: alice.id });
    assert.equal(r.total, 3);
  });

  test('date ranges are inclusive on the house clock', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    assert.equal((await queryAudit({ q: TAG, from: today, to: today })).total, 3);
    assert.equal((await queryAudit({ q: TAG, to: '2020-01-01' })).total, 0);
  });

  test('pages and sorts', async () => {
    const newest = await queryAudit({ q: TAG, pageSize: 50 });
    const oldest = await queryAudit({ q: TAG, sort: 'oldest' });
    assert.equal(newest.rows[0].id, oldest.rows.at(-1)!.id);
    assert.equal(newest.pages, 1);
    const clamped = await queryAudit({ q: TAG, pageSize: 7 });
    assert.equal(clamped.pageSize, 50, 'page sizes outside the allowed set fall back');
  });
});

describe('export', () => {
  test('CSV neutralises spreadsheet formulas and quotes properly', async () => {
    const csv = toCsv(await exportAudit({ q: TAG }));
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^time_utc,action,actor_role/);
    assert.ok(!csv.includes(',=HYPERLINK'), 'a leading = is escaped');
  });
});

describe('facets', () => {
  test('list the categories that have actually been logged', async () => {
    const f = await auditFacets();
    for (const c of ['shift', 'auth', 'roster']) assert.ok(f.categories.includes(c));
    assert.ok(f.total >= 3);
  });
});
