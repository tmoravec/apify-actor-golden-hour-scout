import fs from 'node:fs';
import path from 'node:path';

import { gotScraping } from '@crawlee/utils';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { foldResponseBodyIntoMessage, InputError } from '../src/errors.js';
import { geocode } from '../src/geocode.js';

vi.mock('@crawlee/utils', () => ({ gotScraping: vi.fn() }));

const gotScrapingMock = gotScraping as unknown as Mock;

function loadFixture(name: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf-8'));
}

/** With `responseType: 'json'`, the parsed `body` is all `geocode.ts` reads. */
function jsonResponse(body: unknown) {
    return { body };
}

/** The URL `geocode.ts` handed got on its Nth call. */
function requestedUrl(callIndex = 0): URL {
    return new URL((gotScrapingMock.mock.calls[callIndex][0] as { url: string }).url);
}

describe('geocode', () => {
    beforeEach(() => {
        gotScrapingMock.mockReset();
    });

    it('resolves the first result into a GeoLocation with the exact composite display name', async () => {
        const fixture = loadFixture('geocode-yosemite.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const location = await geocode('Yosemite Valley');

        expect(location.name).toBe('Yosemite Valley, California, United States');
        expect(location.admin1).toBe('California');
        expect(location.country).toBe('United States');
        expect(location.latitude).toBe(37.74075);
        expect(location.longitude).toBe(-119.57788);
        expect(location.timezone).toBe('America/Los_Angeles');
    });

    it('requests the geocoding API with exactly name + count=1&language=en&format=json, and no other params', async () => {
        const fixture = loadFixture('geocode-yosemite.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        await geocode('Yosemite Valley');

        expect(gotScrapingMock).toHaveBeenCalledTimes(1);
        const url = requestedUrl();
        expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
        expect(url.searchParams.get('name')).toBe('Yosemite Valley');
        // Makes "first result wins" a server-side guarantee, not a client slice.
        expect(url.searchParams.get('count')).toBe('1');
        expect(url.searchParams.get('language')).toBe('en');
        expect(url.searchParams.get('format')).toBe('json');

        // Exhaustive: the query carries these four params and nothing else.
        expect([...url.searchParams.keys()].sort()).toEqual(['count', 'format', 'language', 'name']);
    });

    // `gotScraping` ships `throwHttpErrors: false`, so this only looks like a
    // redundant default: without it a 400 is not an error at all and Open-Meteo's
    // `{"error":true,...}` payload reaches the caller as a result. Shipped wrong
    // once already.
    it('turns HTTP errors back into throws, which gotScraping disables by default', async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse(loadFixture('geocode-yosemite.json')));

        await geocode('Yosemite Valley');

        expect((gotScrapingMock.mock.calls[0][0] as { throwHttpErrors: boolean }).throwHttpErrors).toBe(true);
    });

    // Duplicated per call site like `throwHttpErrors`, so the guard is too.
    it("wires the beforeError hook that folds a failed response's body into the message", async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse(loadFixture('geocode-yosemite.json')));

        await geocode('Yosemite Valley');

        const options = gotScrapingMock.mock.calls[0][0] as { hooks: { beforeError: unknown[] } };
        expect(options.hooks.beforeError).toContain(foldResponseBodyIntoMessage);
    });

    // The third per-call-site guard: without a ceiling, got sleeps for whatever a
    // `Retry-After` names, and an hour named is an hour of billed container time.
    it('caps how long a Retry-After can park the run', async () => {
        gotScrapingMock.mockResolvedValue(jsonResponse(loadFixture('geocode-yosemite.json')));

        await geocode('Yosemite Valley');

        const options = gotScrapingMock.mock.calls[0][0] as { retry: { maxRetryAfter: number } };
        expect(options.retry.maxRetryAfter).toBe(10_000);
    });

    it('skips missing admin1/country parts in the composite name, with no dangling separators', async () => {
        const fixture = loadFixture('geocode-missing-parts.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const location = await geocode('Null Island');

        expect(location.name).toBe('Null Island');
        expect(location.admin1).toBeUndefined();
        expect(location.country).toBeUndefined();
        expect(location.name.endsWith(',')).toBe(false);
        expect(location.name).not.toContain(',,');
    });

    // The both-missing fixture only covers the extreme. These pin the
    // one-but-not-both cases, where a mishandled middle part -- a dangling ", ,"
    // or a leading separator -- would otherwise slip past the suite.
    it.each([
        ['admin1 missing, country present', 'geocode-missing-admin1.json', 'Monaco, Monaco', undefined, 'Monaco'],
        [
            'country missing, admin1 present',
            'geocode-missing-country.json',
            'Rothera Point, Adelaide Island',
            'Adelaide Island',
            undefined,
        ],
    ])('composite name with %s', async (_label, fixtureName, expectedName, expectedAdmin1, expectedCountry) => {
        const fixture = loadFixture(fixtureName);
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const location = await geocode('anywhere');

        expect(location.name).toBe(expectedName);
        expect(location.admin1).toBe(expectedAdmin1);
        expect(location.country).toBe(expectedCountry);
        expect(location.name).not.toContain(',,');
        expect(location.name).not.toMatch(/,\s*,/);
        expect(location.name.endsWith(',')).toBe(false);
        expect(location.name.startsWith(',')).toBe(false);
    });

    // The composite name is the one unbounded string the Actor carries into the
    // status message, every dataset item and the report header, so it is capped
    // here at composition rather than at each of those surfaces.
    it('caps an over-long composite name at composition, so no downstream surface has to', async () => {
        const fixture = loadFixture('geocode-long-name.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const location = await geocode('Llanfairpwllgwyngyll');

        expect(location.name.length).toBe(120);
        expect(location.name.endsWith('…')).toBe(true);
        expect(location.name.startsWith('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch,')).toBe(true);
    });

    // The parts travel uncapped deliberately -- nothing recomposes them, and the
    // cap belongs to the composite the Actor actually displays.
    it('leaves the raw admin1/country parts uncapped', async () => {
        const fixture = loadFixture('geocode-long-name.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const location = await geocode('Llanfairpwllgwyngyll');

        expect(location.country).toBe('United Kingdom of Great Britain and Northern Ireland');
        expect(location.admin1).toBe('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch Community');
    });

    // Nothing enforces that the API returns a `timezone`, hence `TargetLocation`'s
    // `timezone: string | null` -- the same zone-not-settled state the `coordinates`
    // path produces. `null` rather than `undefined` is what `resolveLocation`'s `??`
    // is written against, and it makes the missing zone a stated outcome rather than
    // an absent property `tsc` would let a caller hand to `formatIsoLocal`. Not a
    // fail-don't-default case: one source is missing, and the forecast's
    // `timezone=auto` read-back is still to come.
    it('a result missing `timezone` yields null, leaving resolveLocation to fall back to the forecast zone', async () => {
        const fixture = loadFixture('geocode-missing-timezone.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        const location = await geocode('Yosemite Valley');

        expect(location.timezone).toBeNull();
    });

    it('throws an actionable InputError when results are empty, mentioning the place name and the coordinates input', async () => {
        const fixture = loadFixture('geocode-empty.json');
        gotScrapingMock.mockResolvedValue(jsonResponse(fixture));

        // InputError, not just Error: the user gave us something unusable, so the
        // run must exit 2.
        await expect(geocode('xyzzyqwerty')).rejects.toThrow(InputError);
        await expect(geocode('xyzzyqwerty')).rejects.toThrow(/coordinates/i);
    });
});
