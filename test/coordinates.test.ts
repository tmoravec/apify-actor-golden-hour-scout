import { describe, expect, it } from 'vitest';

import { CoordinateInputError, readCoordinatesInput } from '../src/coordinates.js';

describe('readCoordinatesInput', () => {
    it('returns the pair when both fields are set', () => {
        expect(readCoordinatesInput({ latitude: 37.7456, longitude: -119.5936 })).toEqual({
            latitude: 37.7456,
            longitude: -119.5936,
        });
    });

    it('accepts the extremes of both ranges, and zero', () => {
        expect(readCoordinatesInput({ latitude: -90, longitude: -180 })).toEqual({ latitude: -90, longitude: -180 });
        expect(readCoordinatesInput({ latitude: 90, longitude: 180 })).toEqual({ latitude: 90, longitude: 180 });
        // 0 is falsy: it must survive every "is this set?" check on the way through.
        expect(readCoordinatesInput({ latitude: 0, longitude: 0 })).toEqual({ latitude: 0, longitude: 0 });
    });

    // "Not set" is the branch that hands the run to `location`, and blank arrives
    // in more shapes than `undefined`: an unopened Console section, a JSON `null`,
    // or cleared form controls.
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty object', {}],
        ['an object with both fields null', { latitude: null, longitude: null }],
        ['an object with both fields empty strings', { latitude: '', longitude: '' }],
        ['an empty string', ''],
        ['whitespace only', '   '],
    ])('reads %s as "not set" (null), leaving the run to `location`', (_label, input) => {
        expect(readCoordinatesInput(input)).toBeNull();
    });

    // Half a pair must never fall back to `location`: the user meant to shoot at a
    // coordinate, and a geocoded place would be a report about somewhere else.
    it.each([
        ['longitude missing', { latitude: 37.7456 }, /longitude/],
        ['latitude missing', { longitude: -119.5936 }, /latitude/],
        ['longitude blanked out', { latitude: 37.7456, longitude: null }, /longitude/],
    ])('rejects a half-filled pair: %s', (_label, input, expected) => {
        expect(() => readCoordinatesInput(input)).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput(input)).toThrow(expected);
    });

    it('rejects out-of-range latitude, naming the field, the value and its range', () => {
        expect(() => readCoordinatesInput({ latitude: 95, longitude: -119.5936 })).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput({ latitude: 95, longitude: -119.5936 })).toThrow(
            /`coordinates\.latitude` 95 is out of range \(-90 to 90\)/,
        );
    });

    it('rejects out-of-range longitude, naming the field, the value and its range', () => {
        expect(() => readCoordinatesInput({ latitude: 37.7456, longitude: -190 })).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput({ latitude: 37.7456, longitude: -190 })).toThrow(
            /`coordinates\.longitude` -190 is out of range \(-180 to 180\)/,
        );
    });

    // A local run and a hand-rolled API call reach this code without the
    // platform's validation -- the numeric-looking string included, which is NOT
    // coerced: accepting one notation quietly invites the next.
    it.each([
        ['a numeric string', { latitude: '37.7456', longitude: -119.5936 }],
        ['a boolean', { latitude: true, longitude: -119.5936 }],
        ['NaN', { latitude: Number.NaN, longitude: -119.5936 }],
        ['Infinity', { latitude: Number.POSITIVE_INFINITY, longitude: -119.5936 }],
        ['a nested object', { latitude: { degrees: 37 }, longitude: -119.5936 }],
    ])('rejects a non-number latitude: %s', (_label, input) => {
        expect(() => readCoordinatesInput(input)).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput(input)).toThrow(/`coordinates\.latitude` must be a number/);
    });

    // The table above only varies `latitude`, so a hardcoded `'latitude'` in the
    // message would satisfy every row of it. This exercises the other axis.
    it('rejects a non-number longitude', () => {
        const input = { latitude: 37.7456, longitude: '-119.5936' };
        expect(() => readCoordinatesInput(input)).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput(input)).toThrow(/`coordinates\.longitude` must be a number/);
    });

    // The old string input is gone, and anyone still passing one -- a saved task, a
    // scheduled run -- must be told the shape changed rather than have it parsed.
    it.each([
        ['the former decimal string', '37.7456, -119.5936'],
        ['an array pair', [37.7456, -119.5936]],
        ['a bare number', 37.7456],
    ])('rejects the pre-object input shape, pointing at the object form: %s', (_label, input) => {
        expect(() => readCoordinatesInput(input)).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput(input)).toThrow(/must be an object with numeric `latitude` and `longitude`/);
    });

    // Every row of that table shares the message prefix, so this pins that the
    // rejected VALUE is named too: a regression rendering an array as its joined
    // coordinate string would otherwise still pass.
    it('names the rejected value as "an array" for the array-pair shape', () => {
        expect(() => readCoordinatesInput([37.7456, -119.5936])).toThrow(/got an array/);
    });

    // Unless called out, `{ lat, lon }` is indistinguishable from an untouched
    // section: it would read as "not set" and quietly geocode `location`.
    it.each([
        ['abbreviated keys', { lat: 37.7456, lon: -119.5936 }, /`lat`, `lon`/],
        [
            'a stray extra key alongside a valid pair',
            { latitude: 37.7456, longitude: -119.5936, altitude: 1200 },
            /`altitude`/,
        ],
    ])('rejects unrecognised fields: %s', (_label, input, expected) => {
        expect(() => readCoordinatesInput(input)).toThrow(CoordinateInputError);
        expect(() => readCoordinatesInput(input)).toThrow(expected);
    });
});
