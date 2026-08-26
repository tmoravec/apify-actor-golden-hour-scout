import { Actor, log } from 'apify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoordinateInputError } from '../src/coordinates.js';
import { InputError } from '../src/errors.js';
import { geocode } from '../src/geocode.js';
import { resolveLocation, resolveTarget } from '../src/target.js';
import type { GeoLocation, TargetLocation } from '../src/types.js';

vi.mock('../src/geocode.js', () => ({
    geocode: vi.fn(),
}));

/**
 * These two functions fail the run themselves rather than letting a caller do
 * it, so the SDK is stubbed to pin *which* status message and exit code each
 * failure hands `Actor.fail`. The stub resolves, which is also the SDK's
 * `isExiting` case -- so the rethrow after it runs, and every `rejects.toThrow`
 * assertion below still holds.
 */
vi.mock('apify', () => ({
    Actor: { fail: vi.fn() },
    log: { exception: vi.fn() },
}));

const mockedGeocode = vi.mocked(geocode);
const mockedFail = vi.mocked(Actor.fail);
const mockedLogException = vi.mocked(log.exception);

const YOSEMITE_LOCATION: GeoLocation = {
    name: 'Yosemite Valley, California, United States',
    admin1: 'California',
    country: 'United States',
    latitude: 37.7456,
    longitude: -119.5936,
    timezone: 'America/Los_Angeles',
};

beforeEach(() => {
    mockedGeocode.mockReset();
    mockedGeocode.mockResolvedValue(YOSEMITE_LOCATION);
    mockedFail.mockReset();
    mockedLogException.mockReset();
});

describe('target.ts resolveTarget()', () => {
    it('geocodes the trimmed `location` when no coordinates are set, returning the result unchanged', async () => {
        const target = await resolveTarget({ location: '  Yosemite Valley, California  ' });

        expect(mockedGeocode).toHaveBeenCalledTimes(1);
        expect(mockedGeocode).toHaveBeenCalledWith('Yosemite Valley, California');
        expect(target).toEqual(YOSEMITE_LOCATION);
        // A catch block that swallowed and then failed on a non-error would still
        // return the right target; this is what catches it.
        expect(mockedFail).not.toHaveBeenCalled();
    });

    it('lets `coordinates` win over a `location` set at the same time, skipping geocoding entirely', async () => {
        const target = await resolveTarget({
            location: 'Reykjavik',
            coordinates: { latitude: 37.7456, longitude: -119.5936 },
        });

        expect(mockedGeocode).not.toHaveBeenCalled();
        expect(target.name).toBe('37.7456, -119.5936');
        expect(target.latitude).toBe(37.7456);
        expect(target.longitude).toBe(-119.5936);
        expect(target.timezone).toBeNull();
    });

    it.each([
        ['a value needing rounding', 37.74561, '37.7456'],
        ['a whole number', 37, '37.0000'],
    ])('formats the coordinates display name to four decimals: %s', async (_label, latitude, expectedLatitude) => {
        const target = await resolveTarget({ coordinates: { latitude, longitude: -119.5936 } });

        expect(target.name).toBe(`${expectedLatitude}, -119.5936`);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty object', {}],
        ["a blank location's own field", { location: '' }],
        ['a null location, which reads as left blank rather than as a bad type', { location: null }],
        ['whitespace-only location', { location: '   ' }],
        ['blank location alongside an untouched coordinates section', { location: '', coordinates: {} }],
    ])('throws an InputError naming "no location given" when input is blank: %s', async (_label, input) => {
        await expect(resolveTarget(input as never)).rejects.toThrow(InputError);
        await expect(resolveTarget(input as never)).rejects.toThrow(/no location given/i);
        expect(mockedGeocode).not.toHaveBeenCalled();
        // Unusable user input -- exit 2, and the same text the throw carries, so
        // the user reads it without opening the log.
        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/no location given/i), { exitCode: 2 });
    });

    // Unchecked, these reach `.trim()` and fail on exit 1 with a raw `TypeError`:
    // no help to the user, for input that is theirs to fix. The platform's
    // validation does not run on a local run or a hand-rolled API call.
    it.each([
        ['a number', { location: 42 }],
        ['an array', { location: ['Yosemite'] }],
        ['an object', { location: { name: 'Yosemite' } }],
        ['a boolean', { location: true }],
    ])('throws an InputError naming `location` for a non-string location: %s', async (_label, input) => {
        await expect(resolveTarget(input)).rejects.toThrow(InputError);
        await expect(resolveTarget(input)).rejects.toThrow(/`location` must be a place name string/);
        expect(mockedGeocode).not.toHaveBeenCalled();
        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/`location` must be a place name string/), {
            exitCode: 2,
        });
    });

    it("logs the failure with its stack, so the log carries what the status message can't", async () => {
        await expect(resolveTarget({ location: '' })).rejects.toThrow(InputError);

        const [logged, message] = mockedLogException.mock.calls[0] as [Error, string];
        expect(logged).toBeInstanceOf(InputError);
        expect(message).toBe(logged.message);
    });

    // Every row shares that prefix, so this pins that the rejected VALUE is named
    // too, catching a regression that rendered every non-string alike.
    it('names the rejected value in the message, not just the field', async () => {
        await expect(resolveTarget({ location: ['Yosemite'] })).rejects.toThrow(/got an array/);
    });

    it.each([
        ['a half-filled pair', { coordinates: { latitude: 37.7456 } }],
        ['an out-of-range value', { coordinates: { latitude: 95, longitude: -119.5936 } }],
        ['the former coordinate string', { coordinates: '37.7456, -119.5936' }],
    ])(
        'propagates a CoordinateInputError for invalid coordinates rather than falling back to `location`: %s',
        async (_label, input) => {
            await expect(resolveTarget(input)).rejects.toThrow(CoordinateInputError);
            expect(mockedGeocode).not.toHaveBeenCalled();
            // A CoordinateInputError is an InputError, so it takes the same exit
            // code as the checks above rather than the world-misbehaved 1.
            expect(mockedFail).toHaveBeenCalledWith(expect.any(String), { exitCode: 2 });
        },
    );

    // `resolveTarget` is the only boundary function where both exit codes are
    // reachable, which is why it is the only one carrying the branch. Both sides
    // arrive the same way -- as a rejection out of `geocode` -- so neither is a
    // hypothetical.
    it("a geocode InputError (zero results) is the user's to fix: exit 2", async () => {
        mockedGeocode.mockRejectedValue(new InputError('No geocoding results found for "xyzzyqwerty".'));

        await expect(resolveTarget({ location: 'xyzzyqwerty' })).rejects.toThrow(InputError);

        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/No geocoding results found/), { exitCode: 2 });
    });

    it('a geocode transport/HTTP failure is the world misbehaving: exit 1', async () => {
        mockedGeocode.mockRejectedValue(
            new Error('Response code 400 (Bad Request): {"error":true,"reason":"Invalid request"}'),
        );

        await expect(resolveTarget({ location: 'Yosemite Valley' })).rejects.toThrow(/Response code 400/);

        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/Response code 400/), { exitCode: 1 });
    });
});

describe('target.ts resolveLocation()', () => {
    const geocodedTarget: TargetLocation = { ...YOSEMITE_LOCATION };
    const coordinatesTarget: TargetLocation = {
        name: '37.7456, -119.5936',
        latitude: 37.7456,
        longitude: -119.5936,
        timezone: null,
    };

    it("a geocoded target's own timezone wins even when the forecast reports a different one", async () => {
        const location = await resolveLocation(geocodedTarget, 'Etc/UTC');

        expect(location.timezone).toBe('America/Los_Angeles');
        expect(mockedFail).not.toHaveBeenCalled();
    });

    it("a coordinates target (timezone: null) falls back to the forecast's resolved zone", async () => {
        const location = await resolveLocation(coordinatesTarget, 'America/Los_Angeles');

        expect(location.timezone).toBe('America/Los_Angeles');
    });

    it('throws, naming the coordinates and timezone=auto, when neither source has a zone', async () => {
        await expect(resolveLocation(coordinatesTarget, null)).rejects.toThrow(/37\.7456/);
        await expect(resolveLocation(coordinatesTarget, null)).rejects.toThrow(/timezone=auto/);
    });

    // No zone is the world misbehaving, not bad user input: the user gave a valid
    // coordinate pair and Open-Meteo answered without the field it was asked for.
    it('fails the run on exit 1 when neither source has a zone', async () => {
        await expect(resolveLocation(coordinatesTarget, null)).rejects.toThrow(Error);

        expect(mockedFail).toHaveBeenCalledWith(expect.stringMatching(/timezone=auto/), { exitCode: 1 });
    });

    it('passes name/latitude/longitude/admin1/country through untouched', async () => {
        const location = await resolveLocation(geocodedTarget, null);

        expect(location.name).toBe(YOSEMITE_LOCATION.name);
        expect(location.admin1).toBe(YOSEMITE_LOCATION.admin1);
        expect(location.country).toBe(YOSEMITE_LOCATION.country);
        expect(location.latitude).toBe(YOSEMITE_LOCATION.latitude);
        expect(location.longitude).toBe(YOSEMITE_LOCATION.longitude);
    });
});
