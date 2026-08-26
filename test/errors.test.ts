import { HTTPError } from 'got-scraping';
import { describe, expect, it } from 'vitest';

import { describeValue, foldResponseBodyIntoMessage, truncateWithEllipsis } from '../src/errors.js';

/**
 * A got `HTTPError` shaped like a real Open-Meteo rejection. The constructor
 * populates `response` only from a genuine got `Request`, which a unit test
 * cannot produce, so it is assigned afterwards -- the hook reads
 * `error.response.rawBody`, which only a real response shape carries.
 */
function openMeteoHttpError(statusCode: number, rawBody: string): HTTPError {
    const response = { statusCode, statusMessage: 'Bad Request', rawBody: Buffer.from(rawBody) };
    const error = new HTTPError({
        ...response,
        request: { options: { method: 'GET', url: new URL('https://api.open-meteo.com/v1/forecast') } },
    } as never);
    (error as { response?: unknown }).response = response;
    return error;
}

describe('errors.ts foldResponseBodyIntoMessage()', () => {
    it("folds a JSON error body into the message, carrying got's status line and Open-Meteo's reason", () => {
        const error = openMeteoHttpError(
            400,
            '{"error":true,"reason":"Latitude must be in range of -90 to 90°. Given: 999.0."}',
        );

        const result = foldResponseBodyIntoMessage(error);

        expect(result.message).toMatch(/status code 400/);
        expect(result.message).toMatch(/Latitude must be in range of -90 to 90/);
    });

    it('mutates and returns the same instance, rather than wrapping it', () => {
        const error = openMeteoHttpError(400, '{"error":true,"reason":"bad"}');

        const result = foldResponseBodyIntoMessage(error);

        expect(result).toBe(error);
    });

    it('leaves the message untouched when there is no response (e.g. a timeout/DNS failure)', () => {
        const error = { message: 'Timeout awaiting "request" for 30000ms' } as unknown as Parameters<
            typeof foldResponseBodyIntoMessage
        >[0];

        const result = foldResponseBodyIntoMessage(error);

        expect(result.message).toBe('Timeout awaiting "request" for 30000ms');
    });

    it('leaves the message untouched on an empty response body, with no dangling ": "', () => {
        const error = openMeteoHttpError(500, '');

        const result = foldResponseBodyIntoMessage(error);

        expect(result.message).not.toContain(': ""');
        expect(result.message.endsWith(': ')).toBe(false);
        expect(result.message).toMatch(/status code 500/);
    });

    // Open-Meteo's own rejection is a short JSON line, but a 502/503 from a CDN
    // or proxy in front of it is a multi-KB, multi-line HTML page -- and this
    // message goes on to be the run's status message verbatim. The fold is where
    // that unbounded source gets bounded.
    it('collapses a multi-line body to one line and caps it, so a proxy error page cannot run unbounded', () => {
        const htmlErrorPage = `<html>\n<head><title>502 Bad Gateway</title></head>\n<body>\n${'x'.repeat(5000)}\n</body>\n</html>`;
        const error = openMeteoHttpError(502, htmlErrorPage);
        // Read before the call: the hook mutates in place, and the status line's
        // own length is the only reliable anchor for the appended part.
        const statusLine = error.message;

        const result = foldResponseBodyIntoMessage(error);

        const appended = result.message.slice(statusLine.length + ': '.length);
        expect(result.message).not.toContain('\n');
        expect(appended.length).toBe(500);
        expect(appended.endsWith('…')).toBe(true);
    });

    it('passes a short JSON reason through the cap untouched', () => {
        const error = openMeteoHttpError(400, '{"error":true,"reason":"Latitude must be in range of -90 to 90°."}');

        const result = foldResponseBodyIntoMessage(error);

        expect(result.message).toContain('{"error":true,"reason":"Latitude must be in range of -90 to 90°."}');
        expect(result.message).not.toContain('…');
    });
});

// Direct cases, because the two message sources it bounds -- geocoding's
// composite name and the folded response body -- assert their own capped output
// rather than this function's edges.
describe('errors.ts truncateWithEllipsis()', () => {
    it('leaves an under-the-limit string exactly as it is, with no ellipsis', () => {
        expect(truncateWithEllipsis('Yosemite Valley', 120)).toBe('Yosemite Valley');
    });

    it('leaves a string exactly at the limit alone', () => {
        expect(truncateWithEllipsis('a'.repeat(120), 120)).toBe('a'.repeat(120));
    });

    it('caps an over-the-limit string at the limit, ellipsis included', () => {
        const result = truncateWithEllipsis('a'.repeat(5000), 500);

        expect(result.length).toBe(500);
        expect(result.endsWith('…')).toBe(true);
    });

    it('never splits a surrogate pair into a lone half', () => {
        // 🌄 is a surrogate pair, and 498 ASCII characters put the 500-code-unit
        // cap (499 + the ellipsis) exactly between its two halves.
        const result = truncateWithEllipsis(`${'a'.repeat(498)}${'🌄'.repeat(100)}`, 500);

        expect(result.endsWith('…')).toBe(true);
        expect(result.length).toBeLessThanOrEqual(500);
        // A lone surrogate -- high with no low after, or low with no high before.
        // A well-formed pair matches neither.
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result)).toBe(false);
    });
});

// Its callers all assert only the message prefix, never this tail, so a
// regression rendering an array as "37.7456,-119.5936" -- the string-notation
// confusion this codebase works to avoid -- would pass unnoticed. Pinned here,
// one branch at a time.
describe('errors.ts describeValue()', () => {
    it.each([
        ['null', null, 'null'],
        ['an array', [37.7456, -119.5936], 'an array'],
        ['a string', 'hello', '"hello"'],
        ['an object', { latitude: 37.7456 }, 'an object'],
        ['a number', 42, '42'],
        ['a boolean', true, 'true'],
    ])('renders %s as %j', (_label, value, expected) => {
        expect(describeValue(value)).toBe(expected);
    });
});
