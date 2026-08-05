import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchJsonWithRetry } from '../src/http.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

describe('fetchJsonWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('succeeds on the first try with no retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchJsonWithRetry('https://example.com/api');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on a network error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJsonWithRetry('https://example.com/api');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on a 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('server error', 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJsonWithRetry('https://example.com/api');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on a 429 with a longer backoff than a 500, then succeeds', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    // First: capture the delay used after a 500.
    const fetchMock500 = vi
      .fn()
      .mockResolvedValueOnce(textResponse('server error', 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock500);
    const p500 = fetchJsonWithRetry('https://example.com/api');
    await vi.runAllTimersAsync();
    await p500;
    const delay500 = setTimeoutSpy.mock.calls[0]?.[1] as number;
    setTimeoutSpy.mockClear();

    // Then: capture the delay used after a 429.
    const fetchMock429 = vi
      .fn()
      .mockResolvedValueOnce(textResponse('rate limited', 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock429);
    const p429 = fetchJsonWithRetry('https://example.com/api');
    await vi.runAllTimersAsync();
    const result = await p429;
    const delay429 = setTimeoutSpy.mock.calls[0]?.[1] as number;

    expect(result).toEqual({ ok: true });
    expect(fetchMock429).toHaveBeenCalledTimes(2);
    expect(delay429).toBeGreaterThan(delay500);

    setTimeoutSpy.mockRestore();
  });

  // 400 and 404 are the same non-retryable branch; both are listed to pin the
  // ends of the 4xx range that must NOT be retried, without a test each.
  it.each([
    [400, 'bad request: unknown parameter'],
    [404, 'not found'],
  ])('fails immediately on a %i with no retry, including the response body in the error', async (status, body) => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(body, status));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJsonWithRetry('https://example.com/api')).rejects.toThrow(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws after 3 failed attempts on repeated 500s', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('server error', 500));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJsonWithRetry('https://example.com/api');
    // Prevent unhandled rejection warnings while timers advance.
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/server error/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws after 3 failed attempts on repeated 429s, mirroring the 500 exhaustion path', async () => {
    // 429 is retryable like 5xx but with a longer backoff, so its exhaustion
    // path SHOULD behave identically to the 500 one -- asserted rather than
    // assumed, since the longer-backoff branch is the one that differs.
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('rate limited', 429));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJsonWithRetry('https://example.com/api');
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/429/);
    await expect(promise).rejects.toThrow(/rate limited/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws after 3 failed attempts on repeated network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJsonWithRetry('https://example.com/api');
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/network down/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('observes exponential backoff delays across repeated failures', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('server error', 500));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJsonWithRetry('https://example.com/api');
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow();

    // 3 attempts -> 2 backoff delays between them, second strictly longer (exponential).
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    expect(delays.length).toBe(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);

    setTimeoutSpy.mockRestore();
  });
});
