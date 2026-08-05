import { describe, it, expect } from 'vitest';
import { buildDayWindows, buildWindows } from '../src/windows.js';
import { compassAzimuth, type SunEvents } from '../src/astronomy.js';
// The PRODUCTION guard, deliberately not a clean-room copy: a local
// `item.type !== 'polar' && item.type !== 'noWindows'` would keep these tests
// green even if `src/types.ts` drifted, while every real consumer
// (`main.ts`'s nextIdealSky filter, `render.ts`'s day sections) regressed.
import { isWindowItem } from '../src/types.js';
import type { HourlySample, GeoLocation, WindowItem, PolarItem, NoWindowsItem, DatasetItem } from '../src/types.js';

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
      expect(new Date(cur.startLocal).getTime()).toBeGreaterThanOrEqual(
        new Date(prev.startLocal).getTime(),
      );
    }

    for (const item of items) {
      expect(isWindowItem(item)).toBe(true);
      const w = item as WindowItem;
      expect(w.date).toBe('2026-08-02');
      expect(new Date(w.startLocal).getTime()).toBeLessThan(new Date(w.endLocal).getTime());
      expect(typeof w.condition).toBe('string');
      expect(w.conditionSequence.length).toBeGreaterThan(0);
      expect(typeof w.idealSky).toBe('boolean');
      expect(w.conditions).toHaveProperty('cloudTotal');
      expect(w.conditions).toHaveProperty('cloudLow');
      expect(w.conditions).toHaveProperty('cloudMid');
      expect(w.conditions).toHaveProperty('cloudHigh');
      expect(w.conditions).toHaveProperty('precipProb');
      expect(w.sun.sunrise).toBe('2026-08-02T06:00:00+00:00');
      expect(w.sun.sunset).toBe('2026-08-02T18:30:00+00:00');
      expect(typeof w.sun.azimuthAtPeak).toBe('number');
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

  it('conditionSequence reflects a mixed-code window (no aggregation, sequence shows both)', () => {
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
      sample('2026-08-02T21:00:00Z', { weatherCode: 61 }), // Rain
    ];

    const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
    const w = items[0] as WindowItem;
    expect(w.conditionSequence).toEqual(['Partly cloudy', 'Rain']);
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
    const samples = [
      sample('2026-08-02T20:00:00Z', { weatherCode: 1, cloudHigh: 45, cloudMid: 12, cloudLow: 1 }),
    ];

    const items = buildDayWindows(events, '2026-08-02', samples, LOCATION_UTC);
    const w = items[0] as WindowItem;
    expect(w.idealSky).toBe(true);
  });

  // The join, not the rule (wmo.test.ts owns the thresholds): idealSky reads
  // the three layers off the SAME midpoint-closest sample the condition label
  // comes from, so a heavy low deck at the midpoint kills the flag even though
  // the surrounding hours are clean.
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

    // The equality above is only meaningful if the edges differ from the
    // midpoint -- otherwise it would hold for a start/end sample too. The sun
    // moves ~15 deg/hour, so over this one-hour window they genuinely differ.
    expect(w.sun.azimuthAtPeak).not.toBe(compassAzimuth(start, latitude, longitude));
    expect(w.sun.azimuthAtPeak).not.toBe(compassAzimuth(end, latitude, longitude));
  });

  it('emits a window iff both of its boundary crossings exist (partial polar day)', () => {
    // Only the evening golden-hour window's boundaries exist; everything else is null
    // (as suncalc would report near the polar circle on a partial day).
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

  it('emits a "polar-day" explanatory item when zero windows are emittable and alwaysUp is set', () => {
    const events = fullDayEvents({
      blueHourMorningStart: null,
      goldenHourMorningStart: null,
      sunrise: null,
      goldenHourMorningEnd: null,
      goldenHourEveningStart: null,
      sunset: null,
      goldenHourEveningEnd: null,
      blueHourEveningEnd: null,
      alwaysUp: true,
      alwaysDown: false,
      polar: 'polar-day',
    });

    const items = buildDayWindows(events, '2026-06-15', [], LOCATION_UTC);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual<PolarItem>({
      date: '2026-06-15',
      type: 'polar',
      reason: 'polar-day',
      location: LOCATION_UTC,
    });
  });

  it('emits a "polar-night" explanatory item when zero windows are emittable and alwaysDown is set', () => {
    const events = fullDayEvents({
      blueHourMorningStart: null,
      goldenHourMorningStart: null,
      sunrise: null,
      goldenHourMorningEnd: null,
      goldenHourEveningStart: null,
      sunset: null,
      goldenHourEveningEnd: null,
      blueHourEveningEnd: null,
      alwaysUp: false,
      alwaysDown: true,
      polar: 'polar-night',
    });

    const items = buildDayWindows(events, '2026-12-15', [], LOCATION_UTC);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual<PolarItem>({
      date: '2026-12-15',
      type: 'polar',
      reason: 'polar-night',
      location: LOCATION_UTC,
    });
  });

  it('emits a non-polar "noWindows" item -- never a polar one -- when zero windows are emittable on an ordinary day', () => {
    // Pins the polar-item heuristic's precondition: `type: 'polar'` is emitted
    // only when `events.polar` actually says the sun never rose or never set.
    // A day that is NOT polar but still produces no windows gets its own
    // explanatory shape rather than being mislabelled polar -- and, crucially,
    // rather than emitting nothing and leaving a silent hole in the 7-day
    // dataset. This state is genuinely reachable by real suncalc; the
    // Reykjavik test below hits it with no synthetic events at all.
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

// These use REAL suncalc astronomy (no synthetic events): the whole point is
// that these states are reachable from actual sky geometry at real, populated
// cities, not just from hand-built event objects. No captured fixture is
// needed -- suncalc is a pure local computation, so only the hourly weather
// samples are synthetic, and they are irrelevant to the geometry under test.
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

    // The shape that matters here: `date` is the solar day, `endLocal` is the NEXT
    // calendar date. They disagree on purpose -- an evening shoot that spills
    // past midnight still belongs to that evening.
    expect(goldenHourEvening!.date).toBe('2026-06-21');
    expect(goldenHourEvening!.startLocal.slice(0, 10)).toBe('2026-06-21');
    expect(goldenHourEvening!.endLocal.slice(0, 10)).toBe('2026-06-22');

    // ...and it is a real multi-hour window, not a degenerate one.
    const spanMinutes =
      (new Date(goldenHourEvening!.endLocal).getTime() - new Date(goldenHourEvening!.startLocal).getTime()) / 60_000;
    expect(spanMinutes).toBeGreaterThan(120);
  });

  it('Reykjavik 2026-06-21: an ordinary sunrise/sunset day with zero emittable windows emits one explanatory noWindows item', () => {
    // Atlantic/Reykjavik is UTC+0 year-round, so local midnight is 00:00Z.
    const samples = makeSamples('2026-06-21T00:00:00Z', 24);
    const items = buildWindows(samples, REYKJAVIK);

    // Exactly one item, and it is NOT polar: the sun genuinely rises and sets
    // here (alwaysUp/alwaysDown are both false) -- it just never reaches the
    // golden/blue-hour boundaries, so no window has both of its crossings.
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('noWindows');
    expect(items[0]).toEqual<NoWindowsItem>({
      date: '2026-06-21',
      type: 'noWindows',
      reason: 'no-boundary-crossings',
      location: REYKJAVIK,
    });

    // The regression this guards: emitting NOTHING, which left the date
    // missing from the dataset with no way to tell it from a dropped record.
    expect(items).not.toHaveLength(0);
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

describe('buildWindows (local-day enumeration from the hourly-array structure)', () => {
  it('is now-free: every window of a long-past week is emitted, none filtered', () => {
    // windows.ts performs no "now"-based filtering; that is main.ts/report's
    // job later. Asserting the exact count matters: a `length > 0` check here
    // would still pass if 27 of the 28 windows were silently dropped.
    const location: GeoLocation = { ...LOCATION_UTC, latitude: 37.7456, longitude: -119.5936 };
    const samples = makeSamples('2020-01-01T00:00:00Z', 24 * 7);

    const items = buildWindows(samples, location);

    expect(items).toHaveLength(28); // 7 days x 4 window types, all in 2020
    expect(items.every((i) => i.type !== 'polar')).toBe(true);
    for (const item of items) {
      expect(new Date((item as WindowItem).endLocal).getTime()).toBeLessThan(Date.now());
    }
  });

  it('enumerates exactly the 7 correct local dates for a synthetic UTC+13 hourly array', () => {
    // Pacific/Tongatapu is UTC+13 with no DST. Local midnight of local date
    // 2026-08-01 is 2026-07-31T11:00:00Z. A naive UTC-calendar-day grouping
    // of this array would misattribute nearly every hour to the wrong local
    // date; only slicing the array into consecutive 24-sample chunks (as
    // Open-Meteo's timezone=auto response guarantees) gets this right.
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
  });

  it('rejects an hourly array whose length is not a multiple of 24', () => {
    const samples = makeSamples('2026-08-01T00:00:00Z', 25);
    expect(() => buildWindows(samples, LOCATION_UTC)).toThrow();
  });
});

/** Builds `count` consecutive hourly synthetic samples starting at `startIso`. */
function makeSamples(startIso: string, count: number): HourlySample[] {
  const start = new Date(startIso).getTime();
  const result: HourlySample[] = [];
  for (let i = 0; i < count; i++) {
    result.push(sample(new Date(start + i * 60 * 60 * 1000).toISOString(), { weatherCode: (i % 4) === 0 ? 1 : 2 }));
  }
  return result;
}
