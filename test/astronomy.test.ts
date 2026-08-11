import { describe, expect, it } from 'vitest';

import { compassAzimuth, getSunEvents } from '../src/astronomy.js';

const YOSEMITE_LAT = 37.7456;
const YOSEMITE_LON = -119.5936;

function assertDate(d: Date | null): asserts d is Date {
    expect(d).not.toBeNull();
}

describe('getSunEvents (Yosemite, fixed summer date, local-noon input)', () => {
    // Local noon PDT (UTC-7) on 2026-08-02 -> 19:00Z. One ordinary mid-latitude
    // day covers every non-polar branch; a second summer date adds no path.
    // Polar days and the local-noon input rule have their own describes below.
    const localNoonUtc = new Date('2026-08-02T19:00:00Z');

    it('orders the four morning boundary crossings correctly', () => {
        const events = getSunEvents(localNoonUtc, YOSEMITE_LAT, YOSEMITE_LON);

        assertDate(events.blueHourMorningStart);
        assertDate(events.goldenHourMorningStart);
        assertDate(events.sunrise);
        assertDate(events.goldenHourMorningEnd);

        expect(events.blueHourMorningStart.getTime()).toBeLessThan(events.goldenHourMorningStart.getTime());
        expect(events.goldenHourMorningStart.getTime()).toBeLessThan(events.sunrise.getTime());
        expect(events.sunrise.getTime()).toBeLessThan(events.goldenHourMorningEnd.getTime());
    });

    it('orders the four evening boundary crossings correctly (mirrored)', () => {
        const events = getSunEvents(localNoonUtc, YOSEMITE_LAT, YOSEMITE_LON);

        assertDate(events.goldenHourEveningStart);
        assertDate(events.sunset);
        assertDate(events.goldenHourEveningEnd);
        assertDate(events.blueHourEveningEnd);

        expect(events.goldenHourEveningStart.getTime()).toBeLessThan(events.sunset.getTime());
        expect(events.sunset.getTime()).toBeLessThan(events.goldenHourEveningEnd.getTime());
        expect(events.goldenHourEveningEnd.getTime()).toBeLessThan(events.blueHourEveningEnd.getTime());
    });

    it('reports non-polar (no alwaysUp/alwaysDown)', () => {
        const events = getSunEvents(localNoonUtc, YOSEMITE_LAT, YOSEMITE_LON);
        expect(events.alwaysUp).toBe(false);
        expect(events.alwaysDown).toBe(false);
        expect(events.polar).toBeNull();
    });
});

describe('compassAzimuth', () => {
    // Ranges, not pinned values, on purpose. The failure mode guarded is applying
    // suncalc 1.x's radians formula to a 2.x value already in degrees, which moves
    // the sun to the wrong quadrant -- a quadrant-wide range catches that, while an
    // exact `toBe(290)` would also break on any patch shifting a rounded degree,
    // indistinguishably from the real bug.

    it('puts the sun in the east at the morning golden window (suncalc 2.x degrees, unconverted)', () => {
        const events = getSunEvents(new Date('2026-08-02T19:00:00Z'), YOSEMITE_LAT, YOSEMITE_LON);
        assertDate(events.goldenHourMorningStart);
        assertDate(events.goldenHourMorningEnd);
        const mid = new Date((events.goldenHourMorningStart.getTime() + events.goldenHourMorningEnd.getTime()) / 2);
        // ENE at a summer sunrise in the northern mid-latitudes.
        expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeGreaterThanOrEqual(45);
        expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeLessThanOrEqual(90);
    });

    it('puts the sun in the west at the evening golden window (mirrored)', () => {
        const events = getSunEvents(new Date('2026-08-02T19:00:00Z'), YOSEMITE_LAT, YOSEMITE_LON);
        assertDate(events.goldenHourEveningStart);
        assertDate(events.goldenHourEveningEnd);
        const mid = new Date((events.goldenHourEveningStart.getTime() + events.goldenHourEveningEnd.getTime()) / 2);
        // WNW: the mirror of the morning case about the 180 deg meridian.
        expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeGreaterThanOrEqual(270);
        expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeLessThanOrEqual(315);
    });

    it('stays an integer within [0, 360) across every minute of a full day -- 360 never appears', () => {
        // Swept, not sampled: rounding anything in [359.5, 360) gives exactly 360,
        // and Yosemite really does hit that band (2026-08-01T08:04Z), so a single
        // hand-picked instant passes while the contract is broken. `compassAzimuth`'s
        // `% 360` is what keeps this green.
        for (let minute = 0; minute < 24 * 60; minute++) {
            const at = new Date(Date.UTC(2026, 7, 1, 0, minute));
            const azimuth = compassAzimuth(at, YOSEMITE_LAT, YOSEMITE_LON);
            expect(Number.isInteger(azimuth)).toBe(true);
            expect(azimuth).toBeGreaterThanOrEqual(0);
            expect(azimuth).toBeLessThan(360);
        }
    });
});

describe('solar-day anchoring across the UTC offset range (regression guard)', () => {
    // Each row is a (local noon, lat, lon, offset) whose returned sunrise must land
    // on the intended LOCAL date. Cairo and Sydney guard the ordinary positive
    // offsets; Auckland-in-January and the -12 ocean point are the two cases bare
    // local noon gets wrong, one in each direction, and are why `getSunEvents`
    // shifts its input by the longitude.
    it.each([
        // Local noon 2026-08-01, UTC+2 (no DST) = 10:00Z.
        ['Cairo (UTC+2)', '2026-08-01T10:00:00Z', 30.04, 31.24, 2, '2026-08-01'],
        // Local noon 2026-08-01, UTC+10 (no DST in August) = 02:00Z. Events land
        // in the PREVIOUS UTC calendar date, so only the local date is meaningful.
        ['Sydney (UTC+10)', '2026-08-01T02:00:00Z', -33.87, 151.21, 10, '2026-08-01'],
        // Local noon 2026-01-15 in NZDT = the PREVIOUS day 23:00Z: 11 h from 01-14's
        // UTC noon and 13 h from 01-15's, so suncalc's rounding picks the previous
        // solar day and returned 2026-01-14 events for a 2026-01-15 request.
        ['Auckland (UTC+13, NZDT)', '2026-01-14T23:00:00Z', -36.85, 174.76, 13, '2026-01-15'],
        // The mirror failure, wrong in every season: a western longitude at a
        // nominal -12, where the rounding overshoots a day LATE. Local noon
        // 2026-08-01 is the NEXT day 00:00Z.
        ['Etc/GMT+12 (UTC-12)', '2026-08-02T00:00:00Z', 0.19, -176.48, -12, '2026-08-01'],
    ])(
        '%s: local-noon input yields sunrise on the correct local date',
        (_name, noonIso, lat, lon, offsetHours, expected) => {
            const events = getSunEvents(new Date(noonIso), lat, lon);
            assertDate(events.sunrise);
            const localDate = new Date(events.sunrise.getTime() + offsetHours * 60 * 60 * 1000);
            expect(localDate.toISOString().slice(0, 10)).toBe(expected);
        },
    );
});

describe('polar detection (Longyearbyen, 78.22N 15.63E)', () => {
    const lat = 78.22;
    const lon = 15.63;

    it('mid-June: polar day (alwaysUp, custom times null)', () => {
        const localNoonUtc = new Date('2026-06-15T11:00:00Z');
        const events = getSunEvents(localNoonUtc, lat, lon);
        expect(events.alwaysUp).toBe(true);
        expect(events.alwaysDown).toBe(false);
        expect(events.sunrise).toBeNull();
        expect(events.sunset).toBeNull();
        expect(events.blueHourMorningStart).toBeNull();
        expect(events.goldenHourEveningStart).toBeNull();
        expect(events.polar).toBe('polar-day');
    });

    it('mid-December: polar night (alwaysDown, custom times null)', () => {
        const localNoonUtc = new Date('2026-12-15T11:00:00Z');
        const events = getSunEvents(localNoonUtc, lat, lon);
        expect(events.alwaysDown).toBe(true);
        expect(events.alwaysUp).toBe(false);
        expect(events.sunrise).toBeNull();
        expect(events.sunset).toBeNull();
        expect(events.blueHourMorningStart).toBeNull();
        expect(events.polar).toBe('polar-night');
    });
});
