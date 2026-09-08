import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { GET, OPTIONS } from '../../app/api/tv/route.ts';

describe('TV API endpoint', () => {
  test('OPTIONS returns 204 with CORS headers', async () => {
    const response = await OPTIONS();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  });

  test('GET returns JSON payload with TV schedule format and CORS headers', async () => {
    const req = new NextRequest('http://localhost:3000/api/tv');
    const response = await GET(req);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');

    const json = (await response.json()) as {
      success: boolean;
      timezone: string;
      pollIntervalSeconds: number;
      today: { date: string; dayOfWeek: string; menu: any; lunch: any; dinner: any };
      tomorrow: { date: string; dayOfWeek: string; menu: any; lunch: any; dinner: any };
      summary: { today: string };
    };
    assert.equal(json.success, true);
    assert.equal(json.timezone, 'America/New_York');
    assert.equal(typeof json.pollIntervalSeconds, 'number');
    assert.ok(json.today);
    assert.ok(json.today.date);
    assert.ok(json.today.dayOfWeek);
    assert.ok(json.today.menu);
    assert.ok(Array.isArray(json.today.menu.lunch));
    assert.ok(Array.isArray(json.today.menu.dinner));
    assert.ok(json.today.lunch);
    assert.ok(Array.isArray(json.today.lunch.menu));
    assert.ok(json.summary);
    assert.ok(typeof json.summary.today === 'string');
  });

  test('GET enforces TV_API_KEY when environment variable is present', async () => {
    const originalKey = process.env.TV_API_KEY;
    try {
      process.env.TV_API_KEY = 'secret123';

      const reqNoKey = new NextRequest('http://localhost:3000/api/tv');
      const resNoKey = await GET(reqNoKey);
      assert.equal(resNoKey.status, 401);

      const reqWrongKey = new NextRequest('http://localhost:3000/api/tv?key=wrong');
      const resWrongKey = await GET(reqWrongKey);
      assert.equal(resWrongKey.status, 401);

      const reqValidQuery = new NextRequest('http://localhost:3000/api/tv?key=secret123');
      const resValidQuery = await GET(reqValidQuery);
      assert.equal(resValidQuery.status, 200);

      const reqValidHeader = new NextRequest('http://localhost:3000/api/tv', {
        headers: { 'x-api-key': 'secret123' },
      });
      const resValidHeader = await GET(reqValidHeader);
      assert.equal(resValidHeader.status, 200);
    } finally {
      process.env.TV_API_KEY = originalKey;
    }
  });
});
