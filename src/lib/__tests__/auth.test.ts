/**
 * The pure half of authentication: hashing, PIN rules, TOTP and session
 * tokens. No database; see security.test.ts for revocation, throttling,
 * enrollment and tablet pairing.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPin,
  verifyPin,
  hashSecret,
  isValidPinFormat,
  isValidNewPin,
  isWeakPin,
  verifyAdminPassword,
  signSession,
  verifySession,
  totpAt,
  matchTotp,
  base32Encode,
  base32Decode,
  randomCode,
  normaliseCode,
  safeEqual,
} from '../auth.ts';

before(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64);
});

describe('PIN rules', () => {
  test('sign-in accepts the legacy four digits and the current six', () => {
    assert.ok(isValidPinFormat('0492'));
    assert.ok(isValidPinFormat('049217'));
    assert.ok(!isValidPinFormat('04921'));
    assert.ok(!isValidPinFormat('abcd'));
    assert.ok(!isValidPinFormat(''));
  });

  test('a new PIN must be exactly six digits', () => {
    assert.ok(isValidNewPin('730194'));
    assert.ok(!isValidNewPin('7301'));
    assert.ok(!isValidNewPin('7301945'));
  });

  test('guessable PINs are refused', () => {
    for (const weak of ['000000', '111111', '123456', '987654', '890123', '121212', '123123', '112233', '696969']) {
      assert.ok(isWeakPin(weak), `${weak} should be weak`);
    }
    for (const fine of ['730194', '284615', '509372']) {
      assert.ok(!isWeakPin(fine), `${fine} should be allowed`);
    }
  });
});

describe('hashing', () => {
  test('a correct PIN verifies and a wrong one does not', () => {
    const stored = hashPin('730194');
    assert.ok(verifyPin('730194', stored));
    assert.ok(!verifyPin('730195', stored));
  });

  test('the stored value is salted scrypt and reveals nothing', () => {
    const stored = hashPin('730194');
    assert.match(stored, /^scrypt\$[\w-]+\$[\w-]+$/);
    assert.ok(!stored.includes('730194'));
    assert.notEqual(hashPin('730194'), stored);
  });

  test('missing or malformed hashes fail closed without throwing', () => {
    assert.ok(!verifyPin('730194', null));
    assert.ok(!verifyPin('730194', 'garbage'));
    assert.ok(!verifyPin('730194', 'scrypt$only-one-part'));
    assert.ok(!verifyPin('730194', 'scrypt$AAAA$AAAA'));
  });

  test('safeEqual compares strings of any length', () => {
    assert.ok(safeEqual('abc', 'abc'));
    assert.ok(!safeEqual('abc', 'abcd'));
    assert.ok(!safeEqual('', 'x'));
  });
});

describe('the manager password', () => {
  test('a scrypt hash in ADMIN_PASSWORD_HASH is preferred', () => {
    process.env.ADMIN_PASSWORD_HASH = hashSecret('correct horse battery');
    process.env.ADMIN_PASSWORD = 'something else';
    try {
      assert.ok(verifyAdminPassword('correct horse battery'));
      assert.ok(!verifyAdminPassword('something else'));
    } finally {
      delete process.env.ADMIN_PASSWORD_HASH;
      delete process.env.ADMIN_PASSWORD;
    }
  });

  test('a plaintext ADMIN_PASSWORD still works during an upgrade', () => {
    process.env.ADMIN_PASSWORD = 'correct-horse';
    try {
      assert.ok(verifyAdminPassword('correct-horse'));
      assert.ok(!verifyAdminPassword('wrong-horse'));
      assert.ok(!verifyAdminPassword('x'));
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
  });

  test('with nothing configured, nothing verifies', () => {
    assert.ok(!verifyAdminPassword(''));
    assert.ok(!verifyAdminPassword('anything'));
  });
});

describe('TOTP', () => {
  // RFC 6238 Appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
  const SECRET = base32Encode(Buffer.from('12345678901234567890'));

  test('matches the RFC 6238 test vectors (last six digits)', () => {
    assert.equal(totpAt(SECRET, Math.floor(59 / 30)), '287082');
    assert.equal(totpAt(SECRET, Math.floor(1111111109 / 30)), '081804');
    assert.equal(totpAt(SECRET, Math.floor(1234567890 / 30)), '005924');
  });

  test('base32 round-trips', () => {
    const buf = Buffer.from('any bytes at all \u0000ÿ');
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  });

  test('accepts one step of clock drift either way and reports which step matched', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    assert.equal(matchTotp(SECRET, totpAt(SECRET, step), now), step);
    assert.equal(matchTotp(SECRET, totpAt(SECRET, step - 1), now), step - 1);
    assert.equal(matchTotp(SECRET, totpAt(SECRET, step + 1), now), step + 1);
    assert.equal(matchTotp(SECRET, totpAt(SECRET, step - 3), now), null);
    assert.equal(matchTotp(SECRET, '12345', now), null);
  });
});

describe('one-time codes', () => {
  test('are eight unambiguous characters in two groups', () => {
    for (let i = 0; i < 50; i++) assert.match(randomCode(), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  test('normalise what people actually type', () => {
    assert.equal(normaliseCode('k7qm 3xwd'), 'K7QM-3XWD');
    assert.equal(normaliseCode('K7QM3XWD'), 'K7QM-3XWD');
    assert.equal(normaliseCode('k7qm-3xwO'), 'K7QM-3XW0');
  });
});

describe('session tokens', () => {
  test('round-trip with their credential version', () => {
    const payload = verifySession(signSession({ sub: 'abc', role: 'brother', name: 'Ben Cohen', ver: 3 }));
    assert.equal(payload?.sub, 'abc');
    assert.equal(payload?.role, 'brother');
    assert.equal(payload?.ver, 3);
    assert.equal(typeof payload?.iat, 'number');
  });

  test('a manager session lasts twelve hours, a brother session a year', () => {
    const now = Math.floor(Date.now() / 1000);
    const admin = verifySession(signSession({ sub: 'admin', role: 'admin', name: 'Kitchen Manager', ver: 1 }))!;
    const brother = verifySession(signSession({ sub: 'x', role: 'brother', name: 'Ben', ver: 0 }))!;
    assert.ok(Math.abs(admin.exp - now - 12 * 3600) < 5);
    assert.ok(Math.abs(brother.exp - now - 365 * 86400) < 5);
  });

  test('a tampered payload is rejected', () => {
    const token = signSession({ sub: 'abc', role: 'brother', name: 'Ben Cohen' });
    const [body, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
    decoded.role = 'admin';
    const forged = Buffer.from(JSON.stringify(decoded)).toString('base64url') + '.' + sig;
    assert.equal(verifySession(forged), null);
  });

  test('a token signed with another secret is rejected', () => {
    const token = signSession({ sub: 'abc', role: 'admin', name: 'Kitchen Manager' });
    process.env.SESSION_SECRET = 'b'.repeat(64);
    try {
      assert.equal(verifySession(token), null);
    } finally {
      process.env.SESSION_SECRET = 'a'.repeat(64);
    }
  });

  test('an expired token is rejected', () => {
    assert.equal(verifySession(signSession({ sub: 'abc', role: 'brother', name: 'Ben' }, -1)), null);
  });

  test('malformed tokens are rejected rather than throwing', () => {
    for (const bad of [undefined, '', 'nodot', 'a.b.c', 'a.b.c.d']) assert.equal(verifySession(bad), null);
  });

  test('a short signing secret is refused outright', () => {
    process.env.SESSION_SECRET = 'too-short';
    try {
      assert.throws(() => signSession({ sub: 'x', role: 'brother', name: 'x' }));
    } finally {
      process.env.SESSION_SECRET = 'a'.repeat(64);
    }
  });
});
