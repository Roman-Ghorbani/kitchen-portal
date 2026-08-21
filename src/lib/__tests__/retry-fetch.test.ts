import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeRetryingFetch, type FetchLike } from '../../db/retry-fetch.ts';

/** Records delays instead of waiting, so tests run instantly. */
function recorder() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

const ok = () => new Response('{}', { status: 200 });
const serverError = () => new Response('boom', { status: 503 });
const badRequest = () => new Response('bad sql', { status: 400 });

describe('retrying fetch', () => {
  test('passes a successful response straight through', async () => {
    let calls = 0;
    const impl: FetchLike = async () => {
      calls++;
      return ok();
    };
    const f = makeRetryingFetch(impl, recorder());

    const res = await f('http://x');
    assert.equal(res.status, 200);
    assert.equal(calls, 1, 'should not retry a success');
  });

  test('retries a network failure and succeeds on a later attempt', async () => {
    let calls = 0;
    const impl: FetchLike = async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNRESET');
      return ok();
    };
    const f = makeRetryingFetch(impl, recorder());

    const res = await f('http://x');
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  });

  test('retries a 5xx, which is how a waking compute presents', async () => {
    let calls = 0;
    const impl: FetchLike = async () => {
      calls++;
      return calls < 2 ? serverError() : ok();
    };
    const f = makeRetryingFetch(impl, recorder());

    assert.equal((await f('http://x')).status, 200);
    assert.equal(calls, 2);
  });

  test('does NOT retry a 4xx - that is a real error, not a cold start', async () => {
    let calls = 0;
    const impl: FetchLike = async () => {
      calls++;
      return badRequest();
    };
    const f = makeRetryingFetch(impl, recorder());

    const res = await f('http://x');
    assert.equal(res.status, 400);
    assert.equal(calls, 1, 'bad SQL must fail fast, not retry four times');
  });

  test('backs off exponentially between attempts', async () => {
    const rec = recorder();
    const impl: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const f = makeRetryingFetch(impl, { ...rec, baseDelayMs: 100, maxAttempts: 4 });

    await assert.rejects(() => f('http://x'));
    assert.deepEqual(rec.delays, [100, 200, 400]);
  });

  test('gives up after maxAttempts and rethrows the last error', async () => {
    let calls = 0;
    const impl: FetchLike = async () => {
      calls++;
      throw new Error('ECONNRESET');
    };
    const f = makeRetryingFetch(impl, { ...recorder(), maxAttempts: 3 });

    await assert.rejects(() => f('http://x'), /ECONNRESET/);
    assert.equal(calls, 3);
  });

  test('returns the 5xx rather than throwing once attempts run out', async () => {
    const impl: FetchLike = async () => serverError();
    const f = makeRetryingFetch(impl, { ...recorder(), maxAttempts: 3 });

    const res = await f('http://x');
    assert.equal(res.status, 503, 'caller should see the real status');
  });
});
