/**
 * Retrying fetch for the Neon HTTP driver.
 *
 * Neon's free tier suspends the compute after a few minutes idle, and the
 * first request after that has to wake it - which can time out or return a
 * 5xx rather than waiting. For this app the idle period is the norm: the house
 * checks the schedule in bursts around chapter, then nobody touches it for
 * hours. So the request most likely to fail is a brother opening the app cold,
 * which is exactly the one that must not fail.
 *
 * Retrying with exponential backoff turns that into a slow first load.
 *
 * Kept separate from the client so the backoff behavior can be tested against
 * a fake fetch instead of against a real cold start.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injectable for tests so they do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function makeRetryingFetch(
  fetchImpl: FetchLike,
  options: RetryOptions = {},
): FetchLike {
  const {
    maxAttempts = 4,
    baseDelayMs = 400,
    sleep = defaultSleep,
  } = options;

  return async function retryingFetch(input, init) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetchImpl(input, init);

        // 5xx from the Neon proxy usually means the compute is still waking.
        // 4xx is a real error (bad SQL, auth) and must not be retried.
        if (res.status >= 500 && res.status < 600 && attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        return res;
      } catch (err) {
        // Network-level failure: connection reset, DNS, timeout mid-wake.
        lastError = err;
        if (attempt === maxAttempts) break;
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  };
}
