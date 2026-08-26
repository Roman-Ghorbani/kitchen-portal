/**
 * Who the late-plate endpoints let in.
 *
 * This is the part worth testing hardest. The chef controls are guarded by a
 * shared token rather than a login, so the gate is the only thing standing
 * between the queue and a brother marking his own plate ready as a joke - and
 * the failure that would matter is the gate opening when the token is unset.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';

import { signSession } from '../auth.ts';
import {
  hasDeviceToken,
  callerOf,
  canRead,
  canWrite,
  actorNameOf,
} from '../late-plate-api.ts';
import { PATCH } from '../../app/api/late-plates/[id]/route.ts';

const TOKEN = 'kitchen-tablet-token-abcdef123456';

before(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64);
});

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { headers });
}

function withSession(
  url: string,
  role: 'admin' | 'brother',
  name = 'Ben Torres',
): NextRequest {
  const token = signSession({ sub: role === 'admin' ? 'admin' : 'member-1', role, name });
  return req(url, { cookie: `zbt_session=${token}` });
}

describe('the device token', () => {
  test('is refused when no token is configured at all', () => {
    delete process.env.LATE_PLATE_DEVICE_TOKEN;
    assert.equal(hasDeviceToken(req(`/api/late-plates?device=${TOKEN}`)), false);
    assert.equal(hasDeviceToken(req('/api/late-plates')), false);
  });

  test('is accepted from the query string, a header, or a bearer token', () => {
    process.env.LATE_PLATE_DEVICE_TOKEN = TOKEN;
    try {
      assert.equal(hasDeviceToken(req(`/api/late-plates?device=${TOKEN}`)), true);
      assert.equal(
        hasDeviceToken(req('/api/late-plates', { 'x-api-key': TOKEN })),
        true,
      );
      assert.equal(
        hasDeviceToken(req('/api/late-plates', { authorization: `Bearer ${TOKEN}` })),
        true,
      );
    } finally {
      delete process.env.LATE_PLATE_DEVICE_TOKEN;
    }
  });

  test('rejects a wrong token, including one that is merely a prefix', () => {
    process.env.LATE_PLATE_DEVICE_TOKEN = TOKEN;
    try {
      assert.equal(hasDeviceToken(req('/api/late-plates?device=wrong')), false);
      assert.equal(
        hasDeviceToken(req(`/api/late-plates?device=${TOKEN.slice(0, -1)}`)),
        false,
      );
      assert.equal(hasDeviceToken(req(`/api/late-plates?device=${TOKEN}x`)), false);
    } finally {
      delete process.env.LATE_PLATE_DEVICE_TOKEN;
    }
  });
});

describe('who may read and who may write', () => {
  test('a signed-out stranger may do neither', () => {
    const caller = callerOf(req('/api/late-plates'));
    assert.equal(canRead(caller), false);
    assert.equal(canWrite(caller), false);
  });

  test('a brother may read the queue but not change it', () => {
    const caller = callerOf(withSession('/api/late-plates', 'brother'));
    assert.equal(canRead(caller), true);
    assert.equal(canWrite(caller), false);
  });

  test('the kitchen manager may do both', () => {
    const caller = callerOf(withSession('/api/late-plates', 'admin', 'Roman'));
    assert.equal(canRead(caller), true);
    assert.equal(canWrite(caller), true);
    assert.equal(actorNameOf(caller), 'Roman');
  });

  test('the tablet may do both, and signs the log as itself', () => {
    process.env.LATE_PLATE_DEVICE_TOKEN = TOKEN;
    try {
      const caller = callerOf(req(`/api/late-plates?device=${TOKEN}`));
      assert.equal(canRead(caller), true);
      assert.equal(canWrite(caller), true);
      assert.equal(actorNameOf(caller), 'Kitchen tablet');
    } finally {
      delete process.env.LATE_PLATE_DEVICE_TOKEN;
    }
  });

  test('a tampered session cookie is not a session', () => {
    const caller = callerOf(req('/api/late-plates', { cookie: 'zbt_session=nonsense.sig' }));
    assert.equal(canRead(caller), false);
  });
});

describe('PATCH /api/late-plates/:id', () => {
  const params = Promise.resolve({ id: 'some-id' });

  test('refuses a signed-out caller before touching the database', async () => {
    const res = await PATCH(
      new NextRequest('http://localhost:3000/api/late-plates/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready' }),
      }),
      { params },
    );
    assert.equal(res.status, 401);
  });

  test('refuses a brother trying to mark his own plate ready', async () => {
    const token = signSession({ sub: 'member-1', role: 'brother', name: 'Ben Torres' });
    const res = await PATCH(
      new NextRequest('http://localhost:3000/api/late-plates/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready' }),
        headers: { cookie: `zbt_session=${token}` },
      }),
      { params },
    );
    assert.equal(res.status, 401);
  });

  test('rejects a status outside the allowed set', async () => {
    const token = signSession({ sub: 'admin', role: 'admin', name: 'Roman' });
    const res = await PATCH(
      new NextRequest('http://localhost:3000/api/late-plates/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'delivered' }),
        headers: { cookie: `zbt_session=${token}` },
      }),
      { params },
    );
    assert.equal(res.status, 400);
  });

  test('always answers with CORS headers, even when refusing', async () => {
    const res = await PATCH(
      new NextRequest('http://localhost:3000/api/late-plates/some-id', {
        method: 'PATCH',
        body: '{}',
      }),
      { params },
    );
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
