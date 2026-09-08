import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { GET, PUT, OPTIONS } from '../../app/api/menu/route.ts';
import { getDayMenu, saveDayMenu } from '../menu-service.ts';

const DEVICE_TOKEN = 'test-kiosk-token-xyz';

describe('Menu API endpoint', () => {
  test('OPTIONS returns 204 with CORS headers', async () => {
    const response = await OPTIONS();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(
      response.headers.get('access-control-allow-methods'),
      'GET, POST, PATCH, PUT, OPTIONS',
    );
  });

  test('GET returns 7-day menu payload by default', async () => {
    const req = new NextRequest('http://localhost:3000/api/menu');
    const response = await GET(req);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');

    const json = (await response.json()) as {
      success: boolean;
      today: string;
      daysCount: number;
      todayMenu: { date: string; dayOfWeek: string; lunch: any; dinner: any };
      days: any[];
    };

    assert.equal(json.success, true);
    assert.ok(json.today);
    assert.equal(json.daysCount, 7);
    assert.ok(json.todayMenu);
    assert.ok(json.todayMenu.date);
    assert.equal(json.days.length, 7);
  });

  test('GET returns single day menu when date param is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/menu?date=today');
    const response = await GET(req);
    assert.equal(response.status, 200);

    const json = (await response.json()) as {
      success: boolean;
      date: string;
      dayOfWeek: string;
      isToday: boolean;
    };

    assert.equal(json.success, true);
    assert.ok(json.date);
    assert.equal(json.isToday, true);
  });

  test('PUT /api/menu rejects unauthorized calls without token or admin', async () => {
    const orig = process.env.LATE_PLATE_DEVICE_TOKEN;
    try {
      process.env.LATE_PLATE_DEVICE_TOKEN = DEVICE_TOKEN;
      const req = new NextRequest('http://localhost:3000/api/menu', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-09-08',
          lunch: ['Grilled Cheese', 'Tomato Soup'],
          dinner: ['Spaghetti Bolognese', 'Garlic Bread'],
        }),
      });
      const res = await PUT(req);
      assert.equal(res.status, 401);
    } finally {
      process.env.LATE_PLATE_DEVICE_TOKEN = orig;
    }
  });

  test('PUT /api/menu saves menu successfully with device token', async () => {
    const orig = process.env.LATE_PLATE_DEVICE_TOKEN;
    try {
      process.env.LATE_PLATE_DEVICE_TOKEN = DEVICE_TOKEN;
      const req = new NextRequest(
        `http://localhost:3000/api/menu?device=${DEVICE_TOKEN}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: '2026-09-08',
            lunch: ['Grilled Cheese', 'Tomato Soup'],
            dinner: ['Spaghetti Bolognese', 'Garlic Bread'],
          }),
        },
      );
      const res = await PUT(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.date, '2026-09-08');
      assert.deepEqual(json.menu.lunch.items, ['Grilled Cheese', 'Tomato Soup']);
      assert.deepEqual(json.menu.dinner.items, [
        'Spaghetti Bolognese',
        'Garlic Bread',
      ]);

      // Direct read from getDayMenu matches
      const direct = await getDayMenu('2026-09-08');
      assert.ok(direct);
      assert.deepEqual(direct.lunch.items, ['Grilled Cheese', 'Tomato Soup']);
      assert.deepEqual(direct.dinner.items, [
        'Spaghetti Bolognese',
        'Garlic Bread',
      ]);
      assert.equal(direct.hasMenu, true);
    } finally {
      process.env.LATE_PLATE_DEVICE_TOKEN = orig;
    }
  });

  test('GET enforces MENU_API_TOKEN when configured', async () => {
    const originalToken = process.env.MENU_API_TOKEN;
    try {
      process.env.MENU_API_TOKEN = 'menu_secret_token_123';

      const reqNoToken = new NextRequest('http://localhost:3000/api/menu');
      const resNoToken = await GET(reqNoToken);
      assert.equal(resNoToken.status, 401);

      const reqWrongToken = new NextRequest(
        'http://localhost:3000/api/menu?token=wrong',
      );
      const resWrongToken = await GET(reqWrongToken);
      assert.equal(resWrongToken.status, 401);

      const reqValidQuery = new NextRequest(
        'http://localhost:3000/api/menu?token=menu_secret_token_123',
      );
      const resValidQuery = await GET(reqValidQuery);
      assert.equal(resValidQuery.status, 200);

      const reqBearer = new NextRequest('http://localhost:3000/api/menu', {
        headers: { authorization: 'Bearer menu_secret_token_123' },
      });
      const resBearer = await GET(reqBearer);
      assert.equal(resBearer.status, 200);

      const reqHeader = new NextRequest('http://localhost:3000/api/menu', {
        headers: { 'x-menu-token': 'menu_secret_token_123' },
      });
      const resHeader = await GET(reqHeader);
      assert.equal(resHeader.status, 200);
    } finally {
      process.env.MENU_API_TOKEN = originalToken;
    }
  });
});

