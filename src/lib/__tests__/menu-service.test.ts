/**
 * Reading the menu off the kitchen TV Pi.
 *
 * The Pi is a Raspberry Pi on a house network reached over a tailnet, so the
 * interesting cases are all the ways it fails to answer. None of them may take
 * a page down or keep one waiting.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDayMenu,
  menuSourceConfigured,
  clearMenuCache,
} from '../menu-service.ts';

const DATE = '2026-08-26';
const realFetch = globalThis.fetch;

function stubFetch(impl: typeof globalThis.fetch) {
  globalThis.fetch = impl;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GOOD_BODY = {
  success: true,
  date: DATE,
  hasMenu: true,
  lunch: { label: 'Lunch', serve: '11:00 AM – 2:30 PM', items: ['Chicken tenders'] },
  dinner: {
    label: 'Dinner',
    serve: '4:30 PM – 7:30 PM',
    items: ['Beef stir fry', 'Rice'],
  },
};

beforeEach(() => {
  clearMenuCache();
  process.env.MENU_SOURCE_URL = 'http://zbt-kitchen-tv:8080/api/menu';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MENU_SOURCE_URL;
});

describe('when it is not configured', () => {
  test('it is simply off, and says so', async () => {
    delete process.env.MENU_SOURCE_URL;
    assert.equal(menuSourceConfigured(), false);
    assert.equal(await getDayMenu(DATE), null);
  });

  test('being off does not attempt a request', async () => {
    delete process.env.MENU_SOURCE_URL;
    let called = false;
    stubFetch(async () => {
      called = true;
      return jsonResponse(GOOD_BODY);
    });
    await getDayMenu(DATE);
    assert.equal(called, false);
  });
});

describe('a healthy Pi', () => {
  test('returns the day, both meals, and the date it was asked for', async () => {
    stubFetch(async (input) => {
      assert.match(String(input), /date=2026-08-26/);
      return jsonResponse(GOOD_BODY);
    });

    const menu = await getDayMenu(DATE);
    assert.ok(menu);
    assert.equal(menu.date, DATE);
    assert.equal(menu.hasMenu, true);
    assert.equal(menu.stale, false);
    assert.deepEqual(menu.dinner.items, ['Beef stir fry', 'Rice']);
    assert.equal(menu.lunch.label, 'Lunch');
  });

  test('a day nobody has entered is reported as having no menu', async () => {
    stubFetch(async () =>
      jsonResponse({
        date: DATE,
        lunch: { items: [] },
        dinner: { items: [] },
      }),
    );
    const menu = await getDayMenu(DATE);
    assert.equal(menu?.hasMenu, false);
  });

  test('the second read inside a minute does not hit the Pi again', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      return jsonResponse(GOOD_BODY);
    });
    await getDayMenu(DATE);
    await getDayMenu(DATE);
    assert.equal(calls, 1);
  });
});

describe('an unreachable or unhappy Pi', () => {
  test('a thrown fetch returns null rather than propagating', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    assert.equal(await getDayMenu(DATE), null);
  });

  test('a 500 returns null', async () => {
    stubFetch(async () => jsonResponse({ error: 'boom' }, 500));
    assert.equal(await getDayMenu(DATE), null);
  });

  test('unparseable JSON returns null', async () => {
    stubFetch(async () => new Response('<html>not json</html>', { status: 200 }));
    assert.equal(await getDayMenu(DATE), null);
  });

  /** The behaviour that matters at 4:30 when the Pi reboots mid-service. */
  test('a previously good menu is served stale rather than lost', async () => {
    stubFetch(async () => jsonResponse(GOOD_BODY));
    const fresh = await getDayMenu(DATE);
    assert.equal(fresh?.stale, false);

    clearCacheFreshnessByTimeTravel();
    stubFetch(async () => {
      throw new Error('tailnet down');
    });

    const stale = await getDayMenu(DATE);
    assert.ok(stale);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.dinner.items, ['Beef stir fry', 'Rice']);
  });
});

describe('what arrives is not trusted', () => {
  test('non-string menu items are coerced, blanks dropped', async () => {
    stubFetch(async () =>
      jsonResponse({
        date: DATE,
        lunch: { items: ['Soup', 42, '', '   ', null] },
        dinner: { items: [] },
      }),
    );
    const menu = await getDayMenu(DATE);
    assert.deepEqual(menu?.lunch.items, ['Soup', '42']);
  });

  test('missing meals fall back to sane labels rather than undefined', async () => {
    stubFetch(async () => jsonResponse({ date: DATE }));
    const menu = await getDayMenu(DATE);
    assert.equal(menu?.lunch.label, 'Lunch');
    assert.equal(menu?.dinner.label, 'Dinner');
    assert.deepEqual(menu?.lunch.items, []);
  });

  test('an absurdly long menu is capped', async () => {
    stubFetch(async () =>
      jsonResponse({
        date: DATE,
        lunch: { items: Array.from({ length: 200 }, (_, i) => `Item ${i}`) },
        dinner: { items: [] },
      }),
    );
    const menu = await getDayMenu(DATE);
    assert.equal(menu?.lunch.items.length, 20);
  });

  test('an empty body is a menu-less day, not a crash', async () => {
    stubFetch(async () => jsonResponse({}));
    const menu = await getDayMenu(DATE);
    assert.equal(menu?.hasMenu, false);
    assert.equal(menu?.date, DATE);
  });
});

/**
 * The cache keeps a wall-clock timestamp and there is no injection seam for it,
 * so the only honest way to age an entry from outside is to move the clock.
 */
function clearCacheFreshnessByTimeTravel() {
  const realNow = Date.now;
  const shifted = realNow() + 120_000;
  Date.now = () => shifted;
  process.once('exit', () => {
    Date.now = realNow;
  });
  setTimeout(() => {
    Date.now = realNow;
  }, 0);
}
