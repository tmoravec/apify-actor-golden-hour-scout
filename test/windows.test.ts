import { describe, expect, it } from 'vitest';

import { compassAzimuth, type SunEvents } from '../src/astronomy.js';
import { formatIsoLocal } from '../src/time.js';
import type { DatasetItem, GeoLocation, HourlySample, NoWindowsItem, PolarItem, WindowItem } from '../src/types.js';
// The production guard, not a clean-room copy: a local `type !== 'polar'` check
// would stay green while every real consumer of this one regressed.
import { isWindowItem } from '../src/types.js';
import { buildDayWindows, buildWindows } from '../src/windows.js';

const LOCATION_UTC: GeoLocation = {
    name: 'Test Place',
    latitude: 37.7456,
    longitude: -119.5936,
    timezone: 'UTC',
};

function sample(iso: string, overrides: Partial<HourlySample> = {}): HourlySample {
    return {
        time: new Date(iso),
        weatherCode: 2,
        cloudTotal: 40,
        cloudLow: 10,
        cloudMid: 20,
        cloudHigh: 30,
        precipProb: 5,
        ...overrides,
    };
}

function fullDayEvents(overrides: Partial<SunEvents> = {}): SunEvents {
    return {
        blueHourMorningStart: new Date('2026-08-02T05:00:00Z'),
        goldenHourMorningStart: new Date('2026-08-02T05:30:00Z'),
        sunrise: new Date('2026-08-02T06:00:00Z'),
        goldenHourMorningEnd: new Date('2026-08-02T06:30:00Z'),
        goldenHourEveningStart: new Date('2026-08-02T18:00:00Z'),
        sunset: new Date('2026-08-02T18:30:00Z'),
        goldenHourEveningEnd: new Date('2026-08-02T19:00:00Z'),
        blueHourEveningEnd: new Date('2026-08-02T19:30:00Z'),
        alwaysUp: false,
        alwaysDown: false,
        polar: null,
        ...overrides,
    };
}

describe('buildDayWindows (synthetic astronomy events + synthetic hourly samples)', () => {
    it('builds all four window types in chronological order with the full dataset-item shape', () => {
        const events = fullDayEvents();
        const samples = [
            sample('2026-08-02T04:00:00Z'),
            sample('2026-08-02T05:00:00Z'),
            sample('2026-08-02T06:00:00Z'),
            sample('2026-08-02T07:00:00Z'),
            sample('2026-08-02T17:00:00Z'),
            sample('2026-08-02T18:00:00Z'),
            sample('2026-08-02T19:00:00Z'),
            sample('2026-08-02T20:00:00Z'),
        ];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);

        expect(items).toHaveLength(4);
        expect(items.map((i) => i.type)).toEqual([
            'blueHourMorning',
            'goldenHourMorning',
            'goldenHourEvening',
            'blueHourEvening',
        ]);

        // Chronological order across windows.
        for (let i = 1; i < items.length; i++) {
            const prev = items[i - 1] as WindowItem;
            const cur = items[i] as WindowItem;
            expect(new Date(cur.startLocal).getTime()).toBeGreaterThanOrEqual(new Date(prev.startLocal).getTime());
        }

        for (const item of items) {
            expect(isWindowItem(item)).toBe(true);
            const w = item as WindowItem;
            expect(w.date).toBe('2026-08-02');
            expect(new Date(w.startLocal).getTime()).toBeLessThan(new Date(w.endLocal).getTime());
            expect(w.conditionSequence.length).toBeGreaterThan(0);
            expect(w.sun.sunrise).toBe('2026-08-02T06:00:00+00:00');
            expect(w.sun.sunset).toBe('2026-08-02T18:30:00+00:00');
            expect(w.location).toBe(LOCATION_UTC);
        }
    });

    it('tie-break: a midpoint exactly on HH:30:00, equidistant from two samples, takes the LATER sample', () => {
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: new Date('2026-08-02T20:00:00Z'),
            goldenHourMorningEnd: new Date('2026-08-02T21:00:00Z'), // midpoint = 20:30, tie between 20:00 and 21:00 samples
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [
            sample('2026-08-02T20:00:00Z', { weatherCode: 1 }), // Mainly clear
            sample('2026-08-02T21:00:00Z', { weatherCode: 61 }), // Rain
        ];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        expect(items).toHaveLength(1);
        const w = items[0] as WindowItem;
        expect(w.type).toBe('goldenHourMorning');
        expect(w.condition).toBe('Rain');
        expect(w.wmoCode).toBe(61);
    });

    it('conditionSequence covers all overlapped hours with one entry per hour, duplicates kept', () => {
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: new Date('2026-08-02T20:00:00Z'),
            goldenHourMorningEnd: new Date('2026-08-02T22:00:00Z'),
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [
            sample('2026-08-02T20:00:00Z', { weatherCode: 2 }), // Partly cloudy
            sample('2026-08-02T21:00:00Z', { weatherCode: 2 }), // Partly cloudy
            sample('2026-08-02T22:00:00Z', { weatherCode: 3 }), // Overcast, but hour [22,23) doesn't overlap [20,22)
        ];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        const w = items[0] as WindowItem;
        expect(w.conditionSequence).toEqual(['Partly cloudy', 'Partly cloudy']);
    });

    it('a null weather_code sample -> "n/a" condition/label, wmoCode null, never idealSky', () => {
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: new Date('2026-08-02T20:00:00Z'),
            goldenHourMorningEnd: new Date('2026-08-02T21:00:00Z'), // midpoint = 20:30 -> closest sample 20:00
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [
            sample('2026-08-02T20:00:00Z', { weatherCode: null, cloudLow: null }),
            sample('2026-08-02T21:00:00Z', { weatherCode: null, cloudLow: null }),
        ];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        const w = items[0] as WindowItem;
        expect(w.condition).toBe('n/a');
        expect(w.wmoCode).toBeNull();
        expect(w.idealSky).toBe(false);
        expect(w.conditionSequence).toContain('n/a');
    });

    it('sets idealSky true for a dry code with 30-60% high, <30% mid and <3% low cloud', () => {
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: new Date('2026-08-02T20:00:00Z'),
            goldenHourMorningEnd: new Date('2026-08-02T20:59:00Z'),
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [sample('2026-08-02T20:00:00Z', { weatherCode: 1, cloudHigh: 45, cloudMid: 12, cloudLow: 1 })];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        const w = items[0] as WindowItem;
        expect(w.idealSky).toBe(true);
    });

    // The join, not the rule -- wmo.test.ts owns the thresholds. `idealSky` reads
    // its layers off the SAME midpoint-closest sample as the condition label, so a
    // low deck at the midpoint kills the flag though the neighbouring hours are
    // clean.
    it('sets idealSky false when the midpoint-closest sample carries the low cloud deck', () => {
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: new Date('2026-08-02T20:00:00Z'),
            goldenHourMorningEnd: new Date('2026-08-02T20:59:00Z'),
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [
            sample('2026-08-02T19:00:00Z', { weatherCode: 1, cloudHigh: 45, cloudMid: 12, cloudLow: 0 }),
            sample('2026-08-02T20:00:00Z', { weatherCode: 1, cloudHigh: 45, cloudMid: 12, cloudLow: 80 }),
        ];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        const w = items[0] as WindowItem;
        expect(w.conditions.cloudLow).toBe(80);
        expect(w.idealSky).toBe(false);
    });

    // Nothing in src/ consumes `conditionSequence`, so an empty array reaches
    // users unguarded. It is the intended output: `condition` resolves off the
    // midpoint-closest sample regardless of overlap, so it is not "n/a" here.
    it('conditionSequence is empty when no sample overlaps the window, even though condition still resolves off the closest one', () => {
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: new Date('2026-08-02T20:00:00Z'),
            goldenHourMorningEnd: new Date('2026-08-02T21:00:00Z'),
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [sample('2026-08-02T08:00:00Z', { weatherCode: 1 })];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        const w = items[0] as WindowItem;

        expect(w.conditionSequence).toEqual([]);
        expect(w.condition).toBe('Mainly clear');
    });

    it('sun.azimuthAtPeak is compassAzimuth sampled at the window MIDPOINT, not at either edge', () => {
        const start = new Date('2026-08-02T20:00:00Z');
        const end = new Date('2026-08-02T21:00:00Z');
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: start,
            goldenHourMorningEnd: end,
            goldenHourEveningStart: null,
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
        });
        const samples = [sample('2026-08-02T20:00:00Z')];
        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        const w = items[0] as WindowItem;

        const mid = new Date((start.getTime() + end.getTime()) / 2);
        const { latitude, longitude } = LOCATION_UTC;
        expect(w.sun.azimuthAtPeak).toBe(compassAzimuth(mid, latitude, longitude));

        // The equality above only means something if the edges differ from the
        // midpoint. The sun moves ~15 deg/hour, so over this hour they do.
        expect(w.sun.azimuthAtPeak).not.toBe(compassAzimuth(start, latitude, longitude));
        expect(w.sun.azimuthAtPeak).not.toBe(compassAzimuth(end, latitude, longitude));
    });

    it('emits a window iff both of its boundary crossings exist (partial polar day)', () => {
        // Only the evening golden hour has both boundaries, as suncalc reports
        // near the polar circle on a partial day.
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: null,
            sunrise: null,
            goldenHourMorningEnd: null,
            goldenHourEveningStart: new Date('2026-08-02T18:00:00Z'),
            goldenHourEveningEnd: new Date('2026-08-02T19:00:00Z'),
            blueHourEveningEnd: null,
        });
        const samples = [sample('2026-08-02T18:00:00Z')];

        const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('goldenHourEvening');
    });

    // Both reasons are pinned, but `buildDayWindows` only copies `events.polar`
    // into `reason`, so one table beats two near-identical bodies.
    it.each([
        ['polar-day', '2026-06-15'],
        ['polar-night', '2026-12-15'],
    ] as const)(
        'emits a "%s" explanatory item when zero windows are emittable and that marker is set',
        (reason, date) => {
            const events = fullDayEvents({
                blueHourMorningStart: null,
                goldenHourMorningStart: null,
                sunrise: null,
                goldenHourMorningEnd: null,
                goldenHourEveningStart: null,
                sunset: null,
                goldenHourEveningEnd: null,
                blueHourEveningEnd: null,
                alwaysUp: reason === 'polar-day',
                alwaysDown: reason === 'polar-night',
                polar: reason,
            });

            const items = buildDayWindows(events, date, [], LOCATION_UTC);
            expect(items).toHaveLength(1);
            expect(items[0]).toEqual<PolarItem>({
                date,
                type: 'polar',
                reason,
                location: LOCATION_UTC,
            });
        },
    );

    // `buildDayWindows`' precondition: `findClosestSample` reads `samples[0]`
    // unconditionally, so an empty array is safe only when no boundary pair is
    // set. Pins what happens if `buildWindows`' guarantee is ever bypassed.
    it('throws rather than silently misreading a window when allSamples is empty but a window is emittable', () => {
        const events = fullDayEvents();

        expect(() => buildDayWindows(events, '2026-08-02', [], LOCATION_UTC)).toThrow();
    });

    it('emits a non-polar "noWindows" item -- never a polar one -- when zero windows are emittable on an ordinary day', () => {
        // `type: 'polar'` is emitted only when `events.polar` says the sun never
        // rose or set. A non-polar day with no windows gets its own shape rather
        // than a wrong label -- or a silent hole in the 7-day dataset. The
        // Reykjavik test below reaches this state through real suncalc.
        const events = fullDayEvents({
            blueHourMorningStart: null,
            goldenHourMorningStart: null,
            sunrise: new Date('2026-06-21T02:55:00Z'),
            goldenHourMorningEnd: new Date('2026-06-21T05:39:00Z'),
            goldenHourEveningStart: new Date('2026-06-21T21:19:00Z'),
            sunset: new Date('2026-06-22T00:04:00Z'),
            goldenHourEveningEnd: null,
            blueHourEveningEnd: null,
            alwaysUp: false,
            alwaysDown: false,
            polar: null,
        });

        const items = buildDayWindows(events, '2026-06-21', [], LOCATION_UTC);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual<NoWindowsItem>({
            date: '2026-06-21',
            type: 'noWindows',
            reason: 'no-boundary-crossings',
            location: LOCATION_UTC,
        });
    });
});

// Real suncalc, no synthetic events: the point is that these states are
// reachable from actual sky geometry at real cities. No fixture needed, suncalc
// being a pure local computation; only the weather samples are synthetic, and
// the geometry under test does not read them.
describe('buildWindows at sub-polar latitudes near the summer solstice (real suncalc)', () => {
    const ANCHORAGE: GeoLocation = {
        name: 'Anchorage, Alaska, United States',
        latitude: 61.2181,
        longitude: -149.9003,
        timezone: 'America/Anchorage',
    };
    const REYKJAVIK: GeoLocation = {
        name: 'Reykjavik, Capital Region, Iceland',
        latitude: 64.1466,
        longitude: -21.9426,
        timezone: 'Atlantic/Reykjavik',
    };

    it("Anchorage 2026-06-21: the evening golden-hour window ends after local midnight, and `date` stays on the window's own solar day", () => {
        // AKDT is UTC-8, so local midnight of 2026-06-21 is 08:00Z.
        const samples = makeSamples('2026-06-21T08:00:00Z', 24);
        const items = buildWindows(samples, ANCHORAGE);

        const goldenHourEvening = items.filter(isWindowItem).find((w) => w.type === 'goldenHourEvening');
        expect(goldenHourEvening).toBeDefined();

        // `date` is the solar day and `endLocal` the NEXT calendar date. They
        // disagree on purpose: an evening shoot spilling past midnight still
        // belongs to that evening.
        expect(goldenHourEvening!.date).toBe('2026-06-21');
        expect(goldenHourEvening!.startLocal.slice(0, 10)).toBe('2026-06-21');
        expect(goldenHourEvening!.endLocal.slice(0, 10)).toBe('2026-06-22');

        // ...and it is a real multi-hour window, not a degenerate one.
        const spanMinutes =
            (new Date(goldenHourEvening!.endLocal).getTime() - new Date(goldenHourEvening!.startLocal).getTime()) /
            60_000;
        expect(spanMinutes).toBeGreaterThan(120);

        // That `endLocal` is the one licence a window has to disagree with its
        // own `date`; everything else still holds.
        expectWindowInvariants(items, samples);
    });

    it('Reykjavik 2026-06-21: an ordinary sunrise/sunset day with zero emittable windows emits one explanatory noWindows item', () => {
        // Atlantic/Reykjavik is UTC+0 year-round, so local midnight is 00:00Z.
        const samples = makeSamples('2026-06-21T00:00:00Z', 24);
        const items = buildWindows(samples, REYKJAVIK);

        // Not polar: the sun rises and sets here, it just never reaches the
        // golden/blue-hour boundaries. The regression guarded is emitting
        // NOTHING, which left the date indistinguishable from a dropped record.
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('noWindows');
        expect(items[0]).toEqual<NoWindowsItem>({
            date: '2026-06-21',
            type: 'noWindows',
            reason: 'no-boundary-crossings',
            location: REYKJAVIK,
        });
    });

    it('a full sub-polar week still represents every one of its 7 local days', () => {
        const samples = makeSamples('2026-06-21T00:00:00Z', 24 * 7);
        const items = buildWindows(samples, REYKJAVIK);

        const dates = Array.from(new Set(items.map((i) => i.date)));
        expect(dates).toHaveLength(7);
        expect(dates[0]).toBe('2026-06-21');
        expect(dates[6]).toBe('2026-06-27');
    });
});

// The zone axis, swept rather than sampled: real suncalc against a synthetic
// `timezone=auto`-shaped array. `expectWindowInvariants` is what makes the sweep
// cheap to extend -- it holds for every window at every longitude, so a row needs
// only a name. It replaces three hand-picked offsets that all topped out below
// the failing region, where Auckland in NZDT produced windows a full day before
// their own `date` with the weather join reading hours to match.
describe('buildWindows across the UTC offset range (real suncalc)', () => {
    it.each([
        // name                          lat      lon       timezone                 first local date
        ['Etc/GMT+12 (-12)', 0.19, -176.48, 'Etc/GMT+12', '2026-08-01'],
        ['America/Denver (-6, MDT)', 39.74, -104.99, 'America/Denver', '2026-08-01'],
        ['Africa/Abidjan (0)', 5.32, -4.03, 'Africa/Abidjan', '2026-08-01'],
        ['Asia/Kolkata (+5:30)', 22.57, 88.36, 'Asia/Kolkata', '2026-08-01'],
        ['Australia/Sydney (+10)', -33.87, 151.21, 'Australia/Sydney', '2026-08-01'],
        ['Pacific/Fiji (+12)', -18.14, 178.44, 'Pacific/Fiji', '2026-08-01'],
        // The three far-east cases, all in January so the southern-hemisphere
        // zones are on daylight time and actually reach +13 / +13:45.
        ['Pacific/Chatham (+13:45, DST)', -43.95, -176.55, 'Pacific/Chatham', '2026-01-15'],
        ['Pacific/Auckland (+13, NZDT)', -36.85, 174.76, 'Pacific/Auckland', '2026-01-15'],
        ['Pacific/Kiritimati (+14)', 1.87, -157.4, 'Pacific/Kiritimati', '2026-01-15'],
    ])(
        '%s: 7 local days, 4 windows each, every window self-consistent',
        (_name, latitude, longitude, timezone, firstDate) => {
            const location: GeoLocation = { name: _name, latitude, longitude, timezone };
            const samples = makeSamples(localMidnightUtc(firstDate, timezone).toISOString(), 24 * 7);

            // The array's premise, asserted rather than assumed: sample 0 is local
            // midnight of `firstDate`, which is what `timezone=auto` guarantees and
            // what the 24-slice grouping relies on.
            expect(formatIsoLocal(samples[0].time, timezone).slice(0, 13)).toBe(`${firstDate}T00`);

            const items = buildWindows(samples, location);

            // Every latitude here is far enough from the poles that no day
            // degenerates, so a short count means windows were silently dropped.
            expect(items).toHaveLength(28);
            expect(new Set(items.map((i) => i.date)).size).toBe(7);
            expect(items[0].date).toBe(firstDate);
            expectWindowInvariants(items, samples);
        },
    );
});

// Open-Meteo reports a single `utc_offset_seconds` per response, so a week
// containing a DST transition drifts an hour partway through and index 12 stops
// being local noon. `buildWindows` claims that is harmless; these two weeks check
// the claim.
describe('buildWindows across a DST transition (single-offset hourly array)', () => {
    const DENVER: GeoLocation = {
        name: 'Denver, Colorado, United States',
        latitude: 39.74,
        longitude: -104.99,
        timezone: 'America/Denver',
    };

    it.each([
        ['spring forward', '2026-03-06', '2026-03-12'],
        ['fall back', '2026-10-30', '2026-11-05'],
    ])('%s: still 7 correct local dates and 28 windows', (_name, firstDate, lastDate) => {
        const samples = makeSamples(localMidnightUtc(firstDate, DENVER.timezone).toISOString(), 24 * 7);
        expect(formatIsoLocal(samples[0].time, DENVER.timezone).slice(0, 13)).toBe(`${firstDate}T00`);

        const items = buildWindows(samples, DENVER);
        const dates = [...new Set(items.map((i) => i.date))];

        expect(items).toHaveLength(28);
        expect(dates).toHaveLength(7);
        expect(dates[0]).toBe(firstDate);
        expect(dates[6]).toBe(lastDate);
        expectWindowInvariants(items, samples);
    });
});

describe('buildWindows (local-day enumeration from the hourly-array structure)', () => {
    it('is now-free: every window of a long-past week is emitted, none filtered', () => {
        // The exact count matters: `length > 0` would still pass if 27 of the 28
        // windows were silently dropped.
        const samples = makeSamples('2020-01-01T00:00:00Z', 24 * 7);

        const items = buildWindows(samples, LOCATION_UTC);

        expect(items).toHaveLength(28); // 7 days x 4 window types, all in 2020
        expect(items.every((i) => i.type !== 'polar')).toBe(true);
        // Deliberately NOT `expectWindowInvariants`: `LOCATION_UTC` pairs
        // Yosemite's longitude with the UTC zone, an 8-hour skew no real zone
        // has, so its evening windows genuinely do start after local midnight.
        // The sweep above covers the invariants across real zones.
    });

    it('enumerates exactly the 7 correct local dates for a synthetic UTC+13 hourly array', () => {
        // Pacific/Tongatapu is UTC+13, no DST, so local 2026-08-01 begins at
        // 2026-07-31T11:00:00Z. A UTC-calendar-day grouping would misattribute
        // nearly every hour here; only the 24-sample slicing gets it right.
        const location: GeoLocation = {
            name: "Nuku'alofa",
            latitude: -21.14,
            longitude: -175.2,
            timezone: 'Pacific/Tongatapu',
        };
        const localMidnightDay0Utc = '2026-07-31T11:00:00Z';
        const samples = makeSamples(localMidnightDay0Utc, 24 * 7);

        const items = buildWindows(samples, location);
        const dates = Array.from(new Set(items.map((i) => i.date)));

        expect(dates).toEqual([
            '2026-08-01',
            '2026-08-02',
            '2026-08-03',
            '2026-08-04',
            '2026-08-05',
            '2026-08-06',
            '2026-08-07',
        ]);

        // A naive UTC-day grouping of the same array would produce a different
        // (wrong) set of calendar dates, e.g. including 2026-07-31.
        const naiveUtcDates = new Set(samples.map((s) => s.time.toISOString().slice(0, 10)));
        expect(naiveUtcDates.has('2026-07-31')).toBe(true);
        expect(dates).not.toContain('2026-07-31');

        // `date` comes from the noon sample's clock and never touches suncalc, so
        // the assertions above would hold even with the sun events a day out --
        // the invariants are what tie the two together. (Nuku'alofa's longitude is
        // western, which is why it was already correct where Auckland was not.)
        expectWindowInvariants(items, samples);
    });

    it('rejects an hourly array whose length is not a multiple of 24', () => {
        const samples = makeSamples('2026-08-01T00:00:00Z', 25);
        expect(() => buildWindows(samples, LOCATION_UTC)).toThrow();
    });
});

/**
 * The two cross-field invariants every emitted window satisfies at every
 * longitude, whatever the astronomy underneath.
 *
 * 1. `startLocal`'s calendar date IS `date`. Only `endLocal` may roll over
 *    (`WindowItem.date`'s cross-midnight contract), so a start that disagrees
 *    with its own `date` means the astronomy and the date came from different
 *    days.
 * 2. The midpoint the weather join reads sits inside the forecast's hourly span.
 *    This is the half that fails silently: a midpoint outside the array still
 *    resolves to `samples[0]` via `findClosestSample`, so `condition`, `wmoCode`
 *    and `idealSky` describe hours the forecast never covered while every field
 *    still looks well-formed.
 *
 * Both are checked against the array passed in, so neither assumes an offset.
 * They do assume the zone belongs to the longitude -- true of every real IANA
 * zone, whose widest skews are about 3 h, and deliberately false of
 * `LOCATION_UTC`, where an 8-hour skew really does push evening windows past
 * local midnight and (1) legitimately fails.
 */
function expectWindowInvariants(items: DatasetItem[], samples: HourlySample[]): void {
    const first = samples[0].time.getTime();
    // The last sample covers the hour after it, so the span ends an hour past
    // its own timestamp.
    const last = samples[samples.length - 1].time.getTime() + 60 * 60 * 1000;

    const windows = items.filter(isWindowItem);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
        expect(w.startLocal.slice(0, 10)).toBe(w.date);
        const mid = (new Date(w.startLocal).getTime() + new Date(w.endLocal).getTime()) / 2;
        expect(mid).toBeGreaterThanOrEqual(first);
        expect(mid).toBeLessThanOrEqual(last);
    }
}

/**
 * The UTC instant of local midnight on `localDate` -- the first sample of an
 * Open-Meteo `timezone=auto` response.
 *
 * Guesses UTC midnight, then corrects by the zone's offset there; the second pass
 * settles a guess landing on the far side of a DST transition. Every caller
 * re-asserts the result via `formatIsoLocal`.
 */
function localMidnightUtc(localDate: string, timeZone: string): Date {
    const target = Date.parse(`${localDate}T00:00:00Z`);
    let ms = target;
    for (let pass = 0; pass < 2; pass++) {
        const wallClock = new Intl.DateTimeFormat('sv-SE', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date(ms));
        ms += target - Date.parse(`${wallClock.replace(' ', 'T')}Z`);
    }
    return new Date(ms);
}

/** `count` consecutive hourly samples from `startIso`. */
function makeSamples(startIso: string, count: number): HourlySample[] {
    const start = new Date(startIso).getTime();
    const result: HourlySample[] = [];
    for (let i = 0; i < count; i++) {
        result.push(sample(new Date(start + i * 60 * 60 * 1000).toISOString(), { weatherCode: i % 4 === 0 ? 1 : 2 }));
    }
    return result;
}
