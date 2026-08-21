import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPin,
  verifyPin,
  isValidPinFormat,
  isWeakPin,
  verifyAdminPassword,
  signSession,
  verifySession,
} from '../auth.ts';

before(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.ADMIN_PASSWORD = 'correct-horse';
});

describe('PIN format', () => {
  test('accepts exactly four digits', () => {
    assert.ok(isValidPinFormat('0492'));
    assert.ok(!isValidPinFormat('492'));
    assert.ok(!isValidPinFormat('04920'));
    assert.ok(!isValidPinFormat('abcd'));
    assert.ok(!isValidPinFormat(''));
  });

  test('flags trivially guessable PINs', () => {
    assert.ok(isWeakPin('1234'));
    assert.ok(isWeakPin('0000'));
    assert.ok(!isWeakPin('7391'));
  });
});

describe('PIN hashing', () => {
  test('a correct PIN verifies', () => {
    const stored = hashPin('7391');
    assert.ok(verifyPin('7391', stored));
  });

  test('a wrong PIN does not verify', () => {
    const stored = hashPin('7391');
    assert.ok(!verifyPin('7392', stored));
  });

  test('the PIN is not recoverable from the stored value', () => {
    const stored = hashPin('7391');
    assert.ok(!stored.includes('7391'));
    assert.match(stored, /^scrypt\$/);
  });

  test('the same PIN hashes differently each time (salted)', () => {
    assert.notEqual(hashPin('7391'), hashPin('7391'));
  });

  test('a member with no PIN set never verifies', () => {
    assert.ok(!verifyPin('7391', null));
  });

  test('a malformed stored value is rejected rather than throwing', () => {
    assert.doesNotThrow(() => verifyPin('7391', 'garbage'));
    assert.ok(!verifyPin('7391', 'garbage'));
    assert.ok(!verifyPin('7391', 'scrypt$only-one-part'));
  });
});

describe('admin password', () => {
  test('the correct password verifies', () => {
    assert.ok(verifyAdminPassword('correct-horse'));
  });

  test('a wrong password does not', () => {
    assert.ok(!verifyAdminPassword('wrong-horse'));
  });

  test('a wrong-length password is rejected without throwing', () => {
    assert.doesNotThrow(() => verifyAdminPassword('x'));
    assert.ok(!verifyAdminPassword('x'));
  });
});

describe('sessions', () => {
  test('a signed session round-trips', () => {
    const token = signSession({ sub: 'abc', role: 'brother', name: 'Ben Cohen' });
    const payload = verifySession(token);
    assert.equal(payload?.sub, 'abc');
    assert.equal(payload?.role, 'brother');
    assert.equal(payload?.name, 'Ben Cohen');
  });

  test('a tampered payload is rejected', () => {
    const token = signSession({ sub: 'abc', role: 'brother', name: 'Ben Cohen' });
    const [body, sig] = token.split('.');

    // Re-encode the payload with an escalated role, keeping the old signature.
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
    decoded.role = 'admin';
    const forged =
      Buffer.from(JSON.stringify(decoded)).toString('base64url') + '.' + sig;

    assert.equal(verifySession(forged), null, 'role escalation must be rejected');
  });

  test('a session signed with a different secret is rejected', () => {
    const token = signSession({ sub: 'abc', role: 'admin', name: 'Roman' });
    process.env.SESSION_SECRET = 'b'.repeat(64);
    assert.equal(verifySession(token), null);
    process.env.SESSION_SECRET = 'a'.repeat(64);
  });

  test('an expired session is rejected', () => {
    const token = signSession({ sub: 'abc', role: 'brother', name: 'Ben' }, -1);
    assert.equal(verifySession(token), null);
  });

  test('malformed tokens are rejected rather than throwing', () => {
    assert.equal(verifySession(undefined), null);
    assert.equal(verifySession(''), null);
    assert.equal(verifySession('nodot'), null);
    assert.equal(verifySession('a.b.c.d'), null);
  });
});
