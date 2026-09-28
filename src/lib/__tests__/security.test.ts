/**
 * The stateful half of security, against a real (throwaway) database:
 * session revocation, attempt limiting, setup codes, tablet pairing, the
 * display key, calendar feed links, and who the API lets in.
 *
 * `npm test` points DATABASE_FILE at a fresh migrated database seeded with a
 * demo roster; nothing here touches ./data.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server.js';

import { db } from '../../db/index.ts';
import { members, semesters } from '../../db/schema.ts';
import { signSession, adminCredentialFingerprint } from '../auth.ts';
import { sessionFromToken } from '../session.ts';
import { bumpAdminSessionVersion, adminSessionVersion } from '../app-settings.ts';
import { checkThrottle, recordFailure, clearThrottle, lockSeconds, POLICIES } from '../throttle.ts';
import { issueEnrollmentCode, redeemEnrollmentCode } from '../enrollment.ts';
import {
  startPairing,
  completePairing,
  deviceFromCookie,
  revokeDevice,
  exchangeLegacyToken,
} from '../kiosk.ts';
import { callerOf, canRead, canWrite, actorOf, hasDisplayKey } from '../api-auth.ts';
import { calendarFeedToken, memberFromFeedToken } from '../calendar-feed.ts';
import { PATCH } from '../../app/api/late-plates/[id]/route.ts';
import { GET as tvSchedule } from '../../app/api/tv/schedule/route.ts';
import { GET as tvPlates } from '../../app/api/tv/late-plates/route.ts';

let brother: { id: string; name: string; sessionVersion: number };

before(async () => {
  [brother] = await db
    .select({ id: members.id, name: members.name, sessionVersion: members.sessionVersion })
    .from(members)
    .limit(1);
  assert.ok(brother, 'the test database is seeded with a roster');
});

const req = (url: string, headers: Record<string, string> = {}, init: { method?: string; body?: string } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { headers, ...init });

const brotherCookie = (ver = brother.sessionVersion) =>
  `zbt_session=${signSession({ sub: brother.id, role: 'brother', name: brother.name, ver })}`;

describe('session revocation', () => {
  test('a session issued under the current version is accepted', async () => {
    const token = signSession({ sub: brother.id, role: 'brother', name: brother.name, ver: brother.sessionVersion });
    assert.ok(await sessionFromToken(token));
  });

  test('bumping the version ends every earlier session', async () => {
    const token = signSession({ sub: brother.id, role: 'brother', name: brother.name, ver: brother.sessionVersion });
    await db
      .update(members)
      .set({ sessionVersion: brother.sessionVersion + 1 })
      .where(eq(members.id, brother.id));
    try {
      assert.equal(await sessionFromToken(token), null);
    } finally {
      await db.update(members).set({ sessionVersion: brother.sessionVersion }).where(eq(members.id, brother.id));
    }
  });

  test('a brother taken off the roster is signed out', async () => {
    const token = signSession({ sub: brother.id, role: 'brother', name: brother.name, ver: brother.sessionVersion });
    await db.update(members).set({ active: false }).where(eq(members.id, brother.id));
    try {
      assert.equal(await sessionFromToken(token), null);
    } finally {
      await db.update(members).set({ active: true }).where(eq(members.id, brother.id));
    }
  });

  test('manager sessions from before versioning are refused, current ones pass, a bump ends them', async () => {
    const legacy = signSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager' });
    assert.equal(await sessionFromToken(legacy), null);

    const current = signSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager', ver: await adminSessionVersion(), cf: adminCredentialFingerprint() });
    assert.ok(await sessionFromToken(current));

    process.env.ADMIN_PASSWORD = 'rotated-password';
    try {
      assert.equal(await sessionFromToken(current), null, 'rotating the password ends it');
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
    assert.ok(await sessionFromToken(current));

    await bumpAdminSessionVersion();
    assert.equal(await sessionFromToken(current), null, 'so does sign-out-everywhere');
  });

  test('an admin role cannot be claimed with a member id', async () => {
    const token = signSession({ sub: brother.id, role: 'admin', name: 'x', ver: await adminSessionVersion() });
    assert.equal(await sessionFromToken(token), null);
  });
});

describe('attempt limiting', () => {
  test('locks escalate and cap at a day', () => {
    const p = POLICIES.pin;
    assert.equal(lockSeconds(p, 4), 0);
    assert.equal(lockSeconds(p, 5), 60);
    assert.equal(lockSeconds(p, 6), 120);
    assert.equal(lockSeconds(p, 7), 240);
    assert.equal(lockSeconds(p, 40), 86_400);
  });

  test('five free failures, then a lock that check() reports', async () => {
    const key = `pin:test-${Date.now()}`;
    for (let i = 0; i < 4; i++) {
      const r = await recordFailure([[key, POLICIES.pin]]);
      assert.equal(r.allowed, true);
    }
    const fifth = await recordFailure([[key, POLICIES.pin]]);
    assert.equal(fifth.allowed, false);
    assert.equal(fifth.retryAfter, 60);

    const state = await checkThrottle([key]);
    assert.equal(state.allowed, false);
    assert.ok(state.retryAfter > 0 && state.retryAfter <= 60);

    await clearThrottle(key);
    assert.equal((await checkThrottle([key])).allowed, true);
  });

  test('a lock on either key blocks the attempt', async () => {
    const account = `pin:acct-${Date.now()}`;
    const ip = `ip:198.51.100.${Date.now() % 250}`;
    for (let i = 0; i < POLICIES.ip.free; i++) await recordFailure([[ip, POLICIES.ip]]);
    assert.equal((await checkThrottle([account, ip])).allowed, false);
  });
});

describe('setup codes', () => {
  test('a code works once, for its own member only', async () => {
    const [a, b] = await db.select({ id: members.id }).from(members).limit(2);
    const { code } = await issueEnrollmentCode(a.id);
    assert.equal(await redeemEnrollmentCode(b.id, code), false, 'not for someone else');
    assert.equal(await redeemEnrollmentCode(a.id, code.toLowerCase().replace('-', ' ')), true, 'typed loosely');
    assert.equal(await redeemEnrollmentCode(a.id, code), false, 'burned after one use');
  });

  test('issuing a new code retires the old one', async () => {
    const [m] = await db.select({ id: members.id }).from(members).limit(1);
    const first = await issueEnrollmentCode(m.id);
    const second = await issueEnrollmentCode(m.id);
    assert.equal(await redeemEnrollmentCode(m.id, first.code), false);
    assert.equal(await redeemEnrollmentCode(m.id, second.code), true);
  });
});

describe('kitchen tablet pairing', () => {
  test('a pairing code yields a cookie that identifies the tablet', async () => {
    const { code } = await startPairing('Test tablet');
    const paired = await completePairing(code);
    assert.ok(paired);
    const device = await deviceFromCookie(paired.cookie);
    assert.equal(device?.label, 'Test tablet');
    assert.equal(await completePairing(code), null, 'the code is single-use');
  });

  test('a forged or revoked cookie is refused', async () => {
    const { code } = await startPairing('Revoke me');
    const paired = (await completePairing(code))!;
    const [id] = paired.cookie.split('.');
    assert.equal(await deviceFromCookie(`${id}.not-the-secret`), null);
    await revokeDevice(id);
    assert.equal(await deviceFromCookie(paired.cookie), null);
  });

  test('the old bookmark token converts once and only if it matches', async () => {
    await db.update(semesters).set({ kioskToken: 'legacy-token-123' }).where(eq(semesters.active, true));
    assert.equal(await exchangeLegacyToken('wrong'), null);
    const converted = await exchangeLegacyToken('legacy-token-123');
    assert.ok(converted && (await deviceFromCookie(converted.cookie)));
  });
});

describe('who the API lets in', () => {
  test('a stranger can neither read nor write', async () => {
    const caller = await callerOf(req('/api/late-plates'));
    assert.equal(canRead(caller), false);
    assert.equal(canWrite(caller), false);
  });

  test('a brother can read but not write', async () => {
    const caller = await callerOf(req('/api/late-plates', { cookie: brotherCookie() }));
    assert.equal(canRead(caller), true);
    assert.equal(canWrite(caller), false);
    assert.equal(actorOf(caller).actorRole, 'brother');
  });

  test('a revoked brother session is nobody', async () => {
    const caller = await callerOf(req('/api/late-plates', { cookie: brotherCookie(brother.sessionVersion + 7) }));
    assert.equal(canRead(caller), false);
  });

  test('a paired tablet can read and write, and signs the log as itself', async () => {
    const paired = (await completePairing((await startPairing('Line tablet')).code))!;
    const caller = await callerOf(req('/api/late-plates', { cookie: `zbt_kiosk=${paired.cookie}` }));
    assert.equal(canWrite(caller), true);
    assert.deepEqual(actorOf(caller), { actorName: 'Kitchen tablet (Line tablet)', actorRole: 'kiosk' });
  });

  test('the old ?device= query parameter grants nothing', async () => {
    const caller = await callerOf(req('/api/late-plates?device=legacy-token-123'));
    assert.equal(canRead(caller), false);
  });

  test('PATCH refuses a brother marking his own plate ready, without CORS headers', async () => {
    const res = await PATCH(
      req('/api/late-plates/x', { cookie: brotherCookie() }, { method: 'PATCH', body: JSON.stringify({ status: 'ready' }) }),
      { params: Promise.resolve({ id: 'x' }) },
    );
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('the house display key', () => {
  test('fails closed when unset, and is accepted only from a header', () => {
    delete process.env.TV_API_KEY;
    assert.equal(hasDisplayKey(req('/api/tv/schedule', { 'x-api-key': 'anything' })), false);

    process.env.TV_API_KEY = 'display-key-abc';
    try {
      assert.equal(hasDisplayKey(req('/api/tv/schedule', { 'x-api-key': 'display-key-abc' })), true);
      assert.equal(hasDisplayKey(req('/api/tv/schedule', { authorization: 'Bearer display-key-abc' })), true);
      assert.equal(hasDisplayKey(req('/api/tv/schedule?key=display-key-abc')), false);
      assert.equal(hasDisplayKey(req('/api/tv/schedule', { 'x-api-key': 'display-key-ab' })), false);
    } finally {
      delete process.env.TV_API_KEY;
    }
  });

  test('the display endpoints answer the key and nothing else', async () => {
    process.env.TV_API_KEY = 'display-key-abc';
    try {
      assert.equal((await tvSchedule(req('/api/tv/schedule'))).status, 401);
      assert.equal((await tvSchedule(req('/api/tv/schedule', { cookie: brotherCookie() }))).status, 401);

      const ok = await tvSchedule(req('/api/tv/schedule', { 'x-api-key': 'display-key-abc' }));
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.today.menu.lunch));

      const plates = await tvPlates(req('/api/tv/late-plates', { 'x-api-key': 'display-key-abc' }));
      assert.equal(plates.status, 200);
      const pb = await plates.json();
      for (const p of pb.plates) assert.deepEqual(Object.keys(p).sort(), ['meal', 'name', 'status']);
    } finally {
      delete process.env.TV_API_KEY;
    }
  });
});

describe('calendar feed links', () => {
  test('carry an unforgeable signature over the member id', () => {
    const token = calendarFeedToken(brother.id);
    assert.equal(memberFromFeedToken(token), brother.id);
    assert.equal(memberFromFeedToken(brother.id), null, 'the bare id no longer works');
    assert.equal(memberFromFeedToken(`${brother.id}.AAAAAAAAAAAAAAAAAAAAAA`), null);
  });
});
