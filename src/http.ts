/**
 * Shared HTTP retry helper used by both `geocode.ts` and `weather.ts`.
 *
 * Retry policy:
 * - Network errors (fetch rejects), 5xx responses, and 429 are retried with
 *   exponential backoff.
 * - 429 (Open-Meteo's free-tier rate limit, 600/min) gets a LONGER backoff
 *   than other retryable statuses -- a single run makes <= 2 calls, so a
 *   transient 429 almost certainly clears given more time.
 * - Any other 4xx is a hard fail, immediately, no retry -- client errors
 *   won't heal by waiting, and the response body is included in the thrown
 *   error message so the failure is actionable.
 * - 3 attempts total; if the 3rd attempt also fails, the last error is thrown.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;
/** 429 backoff multiplier relative to the standard exponential delay. */
const RATE_LIMIT_BACKOFF_MULTIPLIER = 2;

/** Attempt number (0-indexed, i.e. the attempt that just failed) -> next backoff delay in ms. */
function backoffDelayMs(attemptIndex: number, rateLimited: boolean): number {
  const exponential = BASE_DELAY_MS * 2 ** attemptIndex;
  return rateLimited ? exponential * RATE_LIMIT_BACKOFF_MULTIPLIER : exponential;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches `url` and parses the response as JSON, retrying on transient
 * failures per the policy above.
 *
 * @throws Error naming the HTTP status and including the response body, or
 *   the network error, once retries (if any) are exhausted.
 */
export async function fetchJsonWithRetry(url: string): Promise<unknown> {
  // Typed (rather than `unknown`) so the "we never throw undefined" property is
  // checkable from the declaration instead of by tracing every loop exit.
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      // `fetch` rejects with an Error in practice; a non-Error throw is
      // normalised rather than passed through, so the type above holds.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffDelayMs(attempt, false));
        continue;
      }
      break;
    }

    if (response.ok) {
      return await response.json();
    }

    const status = response.status;
    const body = await response.text();
    const retryable = status >= 500 || status === 429;

    if (!retryable) {
      throw new Error(`Request to ${url} failed with status ${status}: ${body}`);
    }

    lastError = new Error(`Request to ${url} failed with status ${status}: ${body}`);

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(backoffDelayMs(attempt, status === 429));
      continue;
    }
  }

  // Every loop exit that reaches here has assigned `lastError` first; the guard
  // makes that explicit instead of leaving `throw undefined` reachable on paper.
  if (lastError) throw lastError;
  throw new Error(`Request to ${url} failed after ${MAX_ATTEMPTS} attempts with no recorded error.`);
}
