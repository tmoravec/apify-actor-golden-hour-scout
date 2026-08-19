import fs from 'node:fs';
import path from 'node:path';

import { gotScraping } from '@crawlee/utils';
import { Actor, log } from 'apify';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { foldResponseBodyIntoMessage } from '../src/errors.js';
import { fetchHourlyWeather } from '../src/weather.js';

vi.mock('@crawlee/utils', () => ({ gotScraping: vi.fn() }));

/**
 * `fetchHourlyWeather` fails the run itself, so the SDK is stubbed to pin the
 * status message and exit code. The stub resolves -- the SDK's `isExiting` case
 * -- so the rethrow runs and the `rejects.toThrow` assertions below still hold.
 */
vi.mock('apify', () => ({
    Actor: { fail: vi.fn() },
    log: { exception: vi.fn() },
}));

const gotScrapingMock = gotScraping as unknown as Mock;
const mockedFail = vi.mocked(Actor.fail);
const mockedLogException = vi.mocked(log.exception);

function loadFixture(name: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf-8'));
}

/** With `responseType: 'json'`, the parsed `body` is all `weather.ts` reads. */
function jsonResponse(body: unknown) {
    return { body };
}

/** The URL `weather.ts` handed got on its Nth call. */
function requestedUrl(callIndex = 0): URL {
    return new URL((gotScrapingMock.mock.calls[callIndex][0] as { url: string }).url);
}

describe('fetchHourlyWeather', () => {
    beforeEach(() => {
        gotScrapingMock.mockReset();
        mockedFail.mockReset();
        mockedLogException.mockReset();
    });

    it('requests exactly the 6 hourly variables + timezone=auto&timeformat=unixtime&forecast_days=7, and no other horizon params', async () => {
        const fixture = loadFixture('forecast-yosemite.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        expect(gotScrapingMock).toHaveBeenCalledTimes(1);
        const url = requestedUrl();
        expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
        expect(url.searchParams.get('latitude')).toBe('37.7456');
        expect(url.searchParams.get('longitude')).toBe('-119.5936');

        const hourlyParam = url.searchParams.get('hourly');
        expect(hourlyParam?.split(',')).toEqual([
            'weather_code',
            'cloud_cover',
            'cloud_cover_low',
            'cloud_cover_mid',
            'cloud_cover_high',
            'precipitation_probability',
        ]);
        expect(url.searchParams.get('timezone')).toBe('auto');
        expect(url.searchParams.get('timeformat')).toBe('unixtime');
        expect(url.searchParams.get('forecast_days')).toBe('7');

        // No other horizon-related params (e.g. start_date/end_date/past_days).
        expect(url.searchParams.has('start_date')).toBe(false);
        expect(url.searchParams.has('end_date')).toBe(false);
        expect(url.searchParams.has('past_days')).toBe(false);
    });

    // `gotScraping` ships `throwHttpErrors: false`, so this only looks like a
    // redundant default: without it a 400 is not an error at all and Open-Meteo's
    // `{"error":true,...}` payload lands in the parsing below, failing as
    // "missing the hourly block". Shipped wrong once already.
    it('turns HTTP errors back into throws, which gotScraping disables by default', async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse(loadFixture('forecast-yosemite.json')));

        await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        expect((gotScrapingMock.mock.calls[0][0] as { throwHttpErrors: boolean }).throwHttpErrors).toBe(true);
    });

    // Duplicated per call site like `throwHttpErrors`, so the guard is too.
    it("wires the beforeError hook that folds a failed response's body into the message", async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse(loadFixture('forecast-yosemite.json')));

        await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        const options = gotScrapingMock.mock.calls[0][0] as { hooks: { beforeError: unknown[] } };
        expect(options.hooks.beforeError).toContain(foldResponseBodyIntoMessage);
    });

    // The third per-call-site guard: without a ceiling, got sleeps for whatever a
    // `Retry-After` names, and an hour named is an hour of billed container time.
    it('caps how long a Retry-After can park the run', async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse(loadFixture('forecast-yosemite.json')));

        await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        const options = gotScrapingMock.mock.calls[0][0] as { retry: { maxRetryAfter: number } };
        expect(options.retry.maxRetryAfter).toBe(10_000);
    });

    it('normalizes the real Yosemite fixture into 168 HourlySamples with epoch seconds converted to Date', async () => {
        const fixture = loadFixture('forecast-yosemite.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const { samples } = await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        expect(samples).toHaveLength(168);
        expect(samples[0].time).toBeInstanceOf(Date);
        expect(samples[0].time.getTime()).toBe(1785481200 * 1000);
        expect(samples[0].weatherCode).toBe(0);
        expect(samples[0].cloudTotal).toBe(0);
        expect(samples[0].cloudLow).toBe(0);
        expect(samples[0].cloudMid).toBe(0);
        expect(samples[0].cloudHigh).toBe(0);
        expect(samples[0].precipProb).toBe(0);
        // A catch block that swallowed and failed on a well-formed response would
        // still return these samples; this is what catches it.
        expect(mockedFail).not.toHaveBeenCalled();
    });

    it("surfaces the response's own resolved IANA timezone alongside the samples (the coordinates path's only zone source)", async () => {
        const fixture = loadFixture('forecast-yosemite.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const { timezone } = await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        expect(timezone).toBe('America/Los_Angeles');
    });

    it('a response with no `timezone` field yields timezone: null rather than failing (callers decide)', async () => {
        const fixture = loadFixture('forecast-yosemite.json') as Record<string, unknown>;
        delete fixture.timezone;
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const { samples, timezone } = await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        expect(timezone).toBeNull();
        expect(samples).toHaveLength(168);
    });

    it('missing an optional variable (precipitation_probability) yields null for that field on every sample, others still parsed', async () => {
        const fixture = loadFixture('forecast-missing-precip.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const { samples } = await fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 });

        expect(samples).toHaveLength(168);
        for (const s of samples) {
            expect(s.precipProb).toBeNull();
        }
        expect(samples[0].weatherCode).toBe(0);
        expect(samples[0].cloudLow).toBe(0);
    });

    it('missing weather_code AND all cloud cover variables together is a hard fail naming both signals', async () => {
        const fixture = loadFixture('forecast-missing-both.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        // The message has to say WHICH signals are missing, or the operator cannot
        // act on it.
        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(/weather_code/);
        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(/cloud-cover/);

        // Exit 1 throughout this module: nothing reachable here is the user's
        // input to fix, so there is no branch to get wrong.
        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/weather_code/), { exitCode: 1 });
    });

    it("logs the failure with its stack, so the log carries what the status message can't", async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse({}));

        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(/hourly/);

        const [logged, message] = mockedLogException.mock.calls[0] as [Error, string];
        expect(logged).toBeInstanceOf(Error);
        expect(message).toBe(logged.message);
    });

    // The likeliest real failure, and the one the `beforeError` hook enriches --
    // it has to survive the catch as the status message, not just the log.
    it("fails the run with a rejected request's own message, not a rewritten one", async () => {
        gotScrapingMock.mockRejectedValue(
            new Error('Response code 400 (Bad Request): {"error":true,"reason":"Latitude must be in range."}'),
        );

        await expect(fetchHourlyWeather({ latitude: 999, longitude: -119.5936 })).rejects.toThrow(/Response code 400/);

        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/Latitude must be in range/), { exitCode: 1 });
    });

    it.each([
        ['no hourly block at all', {}],
        ['an hourly block with no time array', { hourly: { weather_code: [0, 1] } }],
        ['an hourly block whose time is not an array', { hourly: { time: 1785481200 } }],
    ])('%s throws the "hourly"/"time" guard -- the first hard fail in the function', async (_label, body) => {
        // Every forecast fixture carries a valid hourly.time, so this guard, which
        // runs before the count and contiguity checks, had no coverage.
        gotScrapingMock.mockResolvedValue(jsonResponse(body));

        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(/hourly/);
        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/hourly/), { exitCode: 1 });
    });

    it('a gap in the hourly array (non-contiguous, even at 168 total samples) throws an actionable error', async () => {
        const fixture = loadFixture('forecast-gap.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(
            /gap|contiguous|3600/i,
        );
        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/gap|contiguous|3600/i), { exitCode: 1 });
    });

    it('a wrong total sample count (!= 168) throws an actionable error naming the actual count', async () => {
        const fixture = loadFixture('forecast-wrong-count.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(/168/);
        await expect(fetchHourlyWeather({ latitude: 37.7456, longitude: -119.5936 })).rejects.toThrow(/100/);
        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/168/), { exitCode: 1 });
    });
});
