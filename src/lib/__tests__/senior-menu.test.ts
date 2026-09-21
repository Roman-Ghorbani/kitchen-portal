import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  signMenuToken,
  verifyMenuToken,
  verifySeniorMenuPassword,
  getClientIp,
} from '../senior-menu-auth.ts';
import { generateWeek } from '../scheduler.ts';
import type { Member } from '../types.ts';

describe('Senior Menu Auth & Rate Limiting', () => {
  const TEST_IP = '192.168.1.100';

  beforeEach(() => {
    clearRateLimit(TEST_IP);
  });

  test('extracts client IP from various headers', () => {
    assert.equal(getClientIp({ 'x-forwarded-for': '203.0.113.195, 70.41.3.18' }), '203.0.113.195');
    assert.equal(getClientIp({ 'x-real-ip': '198.51.100.1' }), '198.51.100.1');
    assert.equal(getClientIp({}), '127.0.0.1');
  });

  test('allows up to 5 attempts before locking out', () => {
    // Initial check
    const initial = checkRateLimit(TEST_IP);
    assert.equal(initial.allowed, true);
    assert.equal(initial.remainingAttempts, 5);

    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const attempt = recordFailedAttempt(TEST_IP);
      assert.equal(attempt.locked, false);
      assert.equal(attempt.remainingAttempts, 5 - i);
      assert.equal(checkRateLimit(TEST_IP).allowed, true);
    }

    // 5th failed attempt triggers lockout
    const fifth = recordFailedAttempt(TEST_IP);
    assert.equal(fifth.locked, true);
    assert.equal(fifth.remainingAttempts, 0);
    assert.ok(fifth.retryAfterMs > 0);

    // Subsequent check is blocked
    const blocked = checkRateLimit(TEST_IP);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);
  });

  test('clearing rate limit restores access', () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(TEST_IP);
    }
    assert.equal(checkRateLimit(TEST_IP).allowed, false);

    clearRateLimit(TEST_IP);
    assert.equal(checkRateLimit(TEST_IP).allowed, true);
  });

  test('signs and verifies 10-year menu tokens', () => {
    const token = signMenuToken();
    assert.ok(token);
    assert.equal(verifyMenuToken(token), true);
    assert.equal(verifyMenuToken('invalid.token'), false);
    assert.equal(verifyMenuToken(undefined), false);
  });

  test('verifies senior menu password against default or config', async () => {
    assert.equal(await verifySeniorMenuPassword('zbt2026'), true);
    assert.equal(await verifySeniorMenuPassword('wrongpassword'), false);
    assert.equal(await verifySeniorMenuPassword(''), false);
  });
});

describe('Make-up debt auto-clearing in scheduler', () => {
  test('member with make-up debt is scheduled and has debt reduced to 0', () => {
    const junior: Member = {
      id: 'junior-debtor',
      name: 'one member',
      classYear: 'junior',
      points: 10, // high points
      exempt: false,
      standingConflicts: [],
      lastServedDate: '2026-09-01',
      makeupDebt: 1, // owes 1 make-up
    };

    const regularJunior: Member = {
      id: 'junior-regular',
      name: 'Regular Junior',
      classYear: 'junior',
      points: 0, // 0 points
      exempt: false,
      standingConflicts: [],
      lastServedDate: '2026-09-01',
      makeupDebt: 0,
    };

    const result = generateWeek({
      weekStart: '2026-09-28',
      members: [junior, regularJunior],
      slotSizes: { lunch: 1, dinner: 1 },
    });

    const debtorAssignments = result.week.slots
      .flatMap((s) => s.assignments)
      .filter((a) => a.memberId === junior.id);

    assert.ok(debtorAssignments.length >= 1, 'debtor was scheduled');
    const pick = result.rationale.find((r) => r.memberId === junior.id);
    assert.equal(pick?.viaMakeupDebt, true, 'picked via make-up debt priority');
  });
});
