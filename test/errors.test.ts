import { Actor, log } from 'apify';
import { HTTPError } from 'got-scraping';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoordinateInputError } from '../src/coordinates.js';
import { describeValue, exitOptionsFor, failRun, foldResponseBodyIntoMessage, InputError } from '../src/errors.js';

vi.mock('apify', () => ({
    Actor: { exit: vi.fn() },
    log: { exception: vi.fn() },
}));

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
});

/**
 * The SDK is stubbed because what needs pinning is not `Actor.exit`'s behaviour
 * but `failRun`'s when `Actor.exit` *returns* instead of exiting -- a real case,
 * via its `isExiting` guard, and one a smoke run cannot reach. The process must
 * still terminate, or the run hangs on the SDK's handles and is reported by
 * timeout rather than as a failure.
 */
describe('errors.ts failRun()', () => {
    const mockedExit = vi.mocked(Actor.exit);
    const mockedLogException = vi.mocked(log.exception);
    let processExit: ReturnType<typeof vi.spyOn>;
    // `Actor.exit` must be awaited before the trailing `process.exit`; exiting
    // first would leave the platform reporting the run with no status message.
    let order: string[];

    beforeEach(() => {
        order = [];
        mockedExit.mockReset();
        mockedExit.mockImplementation(async () => {
            order.push('exit');
        });
        mockedLogException.mockReset();
        // A no-op, not a throw: several cases below are about what happens *after*
        // a call that in production would not return.
        processExit = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
            order.push('processExit');
            return undefined;
        }) as never);
    });

    afterEach(() => {
        processExit.mockRestore();
    });

    it("hands Actor.exit exitOptionsFor's status message and exit code", async () => {
        await failRun(new InputError('no location given'));

        expect(mockedExit).toHaveBeenCalledWith({ statusMessage: 'no location given', exitCode: 2 });
    });

    it('logs the error with its stack, so the log carries what the status message cannot', async () => {
        const error = new Error('the world misbehaved');

        await failRun(error);

        expect(mockedLogException).toHaveBeenCalledWith(error, 'the world misbehaved');
    });

    it("exits the process anyway when Actor.exit returns without exiting (the SDK's isExiting guard)", async () => {
        await failRun(new Error('the world misbehaved'));

        expect(processExit).toHaveBeenCalledWith(1);
    });

    it('awaits Actor.exit before the trailing process.exit, and calls each exactly once on the normal path', async () => {
        await failRun(new Error('the world misbehaved'));

        expect(order).toEqual(['exit', 'processExit']);
        expect(mockedExit).toHaveBeenCalledTimes(1);
        expect(processExit).toHaveBeenCalledTimes(1);
    });

    it('carries the InputError exit code through that fallback rather than defaulting to 1', async () => {
        await failRun(new CoordinateInputError('bad coordinates'));

        expect(processExit).toHaveBeenCalledWith(2);
    });

    it('exits with the mapped code when Actor.exit itself throws', async () => {
        mockedExit.mockRejectedValue(new Error('events.close() failed'));

        await failRun(new InputError('no location given'));

        expect(processExit).toHaveBeenCalledWith(2);
    });

    it('hands log.exception a real Error with a message even when the thrown reason is undefined', async () => {
        // The only thing `failRun`'s `toError` call buys: `log.exception` renders a
        // stack, so a bare `undefined` reason would reach the log with neither that
        // nor a message. The exit code is `exitOptionsFor`'s job, covered below.
        await failRun(undefined);

        const [logged, message] = mockedLogException.mock.calls[0] as [unknown, string];
        expect(logged).toBeInstanceOf(Error);
        expect((logged as Error).message).not.toBe('');
        expect(message).not.toBe('');
    });
});

describe('errors.ts exitOptionsFor()', () => {
    it('an InputError exits 2', () => {
        expect(exitOptionsFor(new InputError('no location given')).exitCode).toBe(2);
    });

    it('a CoordinateInputError (InputError subclass) also exits 2', () => {
        expect(exitOptionsFor(new CoordinateInputError('bad coordinates')).exitCode).toBe(2);
    });

    it('a plain Error exits 1', () => {
        expect(exitOptionsFor(new Error('the world misbehaved')).exitCode).toBe(1);
    });

    it("carries an already-enriched got HTTPError's folded-in reason to the status message, so it reaches the user without the log", () => {
        const error = foldResponseBodyIntoMessage(
            openMeteoHttpError(400, '{"error":true,"reason":"Latitude must be in range of -90 to 90°."}'),
        );

        const { statusMessage } = exitOptionsFor(error);

        expect(statusMessage).toMatch(/Latitude must be in range of -90 to 90/);
    });

    it('truncates an over-the-cap message with an ellipsis rather than letting it run unbounded', () => {
        const { statusMessage } = exitOptionsFor(new Error('a'.repeat(5000)));

        expect(statusMessage.length).toBeLessThan(600);
        expect(statusMessage.endsWith('…')).toBe(true);
    });

    it('collapses embedded newlines to spaces, so the status message is never multi-line', () => {
        const { statusMessage } = exitOptionsFor(new Error('line one\nline two\n\nline three'));

        expect(statusMessage).not.toContain('\n');
        expect(statusMessage).toBe('line one line two line three');
    });

    // A status message reading `undefined` or `[object Object]` explains nothing,
    // so "non-empty" is not a strong enough assertion here.
    it.each([
        ['a plain string', 'went wrong'],
        ['undefined', undefined],
        ['null', null],
        ['a plain object', { code: 'ENOTFOUND' }],
        ['an empty object', {}],
        ['an object with no prototype', Object.create(null)],
        [
            'an object whose toString throws',
            {
                toString() {
                    throw new Error('nope');
                },
            },
        ],
    ])('builds a message that explains something and exits 1 for a non-Error reason: %s', (_label, reason) => {
        const { statusMessage, exitCode } = exitOptionsFor(reason);

        expect(exitCode).toBe(1);
        expect(statusMessage.length).toBeGreaterThan(0);
        expect(['undefined', 'null', '[object Object]']).not.toContain(statusMessage);
    });

    it("keeps a thrown object's own fields in the message, rather than flattening them to [object Object]", () => {
        const { statusMessage } = exitOptionsFor({ code: 'ENOTFOUND', host: 'api.open-meteo.com' });

        expect(statusMessage).toContain('ENOTFOUND');
        expect(statusMessage).toContain('api.open-meteo.com');
    });

    it('keeps a truncated message whole, never splitting a surrogate pair into a lone half', () => {
        // 🌄 is a surrogate pair, and 498 ASCII characters put the 500-code-unit
        // cap (499 + the ellipsis) exactly between its two halves.
        const { statusMessage } = exitOptionsFor(new Error(`${'a'.repeat(498)}${'🌄'.repeat(100)}`));

        expect(statusMessage.endsWith('…')).toBe(true);
        expect(statusMessage.length).toBeLessThanOrEqual(500);
        // A lone surrogate -- high with no low after, or low with no high before.
        // A well-formed pair matches neither.
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(statusMessage)).toBe(
            false,
        );
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
