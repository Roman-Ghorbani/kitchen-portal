/**
 * /api/menu: who may read, who may write, and that what is written reads back.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';

import { GET, PUT } from '../../app/api/menu/route.ts';
import { getDayMenu } from '../menu-service.ts';
import { signSession, adminCredentialFingerprint } from '../auth.ts';
import { adminSessionVersion } from '../app-settings.ts';
import { startPairing, completePairing } from '../kiosk.ts';

const put = (body: unknown, cookie?: string) =>
  new NextRequest('http://localhost:3000/api/menu', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

describe('/api/menu', () => {
  test('refuses a stranger', async () => {
    assert.equal((await GET(new NextRequest('http://localhost:3000/api/menu'))).status, 401);
    assert.equal((await PUT(put({ date: '2026-09-08', lunch: ['Soup'] }))).status, 401);
  });

  test('a paired tablet saves a day and it reads back', async () => {
    const tablet = (await completePairing((await startPairing('Menu test')).code))!;
    const cookie = `zbt_kiosk=${tablet.cookie}`;

    const res = await PUT(put({ date: '2026-09-08', lunch: [' Grilled Cheese ', 'Tomato Soup'], dinner: ['Pasta'] }, cookie));
    assert.equal(res.status, 200);

    const direct = await getDayMenu('2026-09-08');
    assert.deepEqual(direct?.lunch.items, ['Grilled Cheese', 'Tomato Soup']);
    assert.deepEqual(direct?.dinner.items, ['Pasta']);

    const range = await GET(new NextRequest('http://localhost:3000/api/menu?startDate=2026-09-07&days=3', { headers: { cookie } }));
    const body = await range.json();
    assert.equal(body.daysCount, 3);
    assert.equal(body.days[1].hasMenu, true);
  });

  test('clearing both meals removes the day', async () => {
    const cookie = `zbt_session=${signSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager', ver: await adminSessionVersion(), cf: adminCredentialFingerprint() })}`;
    assert.equal((await PUT(put({ date: '2026-09-09', lunch: ['A'] }, cookie))).status, 200);
    assert.equal((await PUT(put({ date: '2026-09-09', lunch: [], dinner: [] }, cookie))).status, 200);
    assert.equal((await getDayMenu('2026-09-09'))?.hasMenu, false);
  });

  test('rejects malformed dates', async () => {
    const cookie = `zbt_session=${signSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager', ver: await adminSessionVersion(), cf: adminCredentialFingerprint() })}`;
    assert.equal((await PUT(put({ date: '9/8/2026', lunch: ['A'] }, cookie))).status, 400);
  });
});
