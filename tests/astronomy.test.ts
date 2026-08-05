import { describe, it, expect } from 'vitest';
import { getTimes as rawGetTimes } from 'suncalc';
import {
  BLUE_HOUR_LOWER,
  BLUE_HOUR_UPPER,
  GOLDEN_HOUR_LOWER,
  GOLDEN_HOUR_UPPER,
  getSunEvents,
  compassAzimuth,
} from '../src/astronomy.js';

const YOSEMITE_LAT = 37.7456;
const YOSEMITE_LON = -119.5936;

function assertDate(d: Date | null): asserts d is Date {
  expect(d).not.toBeNull();
}

describe('elevation boundary constants', () => {
  it('pins the golden/blue-hour elevation angles', () => {
    expect(BLUE_HOUR_LOWER).toBe(-8);
    expect(BLUE_HOUR_UPPER).toBe(-4);
    expect(GOLDEN_HOUR_LOWER).toBe(-4);
    expect(GOLDEN_HOUR_UPPER).toBe(10);
  });
});

describe('getSunEvents (Yosemite, fixed summer date, local-noon input)', () => {
  // Local noon PDT (UTC-7) on 2026-08-02 -> 19:00Z. One ordinary mid-latitude
  // day exercises every non-polar branch; consecutive summer dates at the same
  // latitude add no distinct path, so only one is tested here. Polar days and
  // the local-noon input rule get their own describes below.
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

  it('equator sanity check: sunrise and sunset both occur, roughly 12h apart', () => {
    const localNoonUtc = new Date('2026-08-01T12:00:00Z'); // lon=0 -> local noon = 12:00 UTC
    const events = getSunEvents(localNoonUtc, 0, 0);
    assertDate(events.sunrise);
    assertDate(events.sunset);
    const dayLengthHours = (events.sunset.getTime() - events.sunrise.getTime()) / (60 * 60 * 1000);
    expect(dayLengthHours).toBeGreaterThan(11.5);
    expect(dayLengthHours).toBeLessThan(12.5);
  });
});

describe('compassAzimuth', () => {
  // These assert RANGES, not pinned values, on purpose. The failure mode being
  // guarded is applying suncalc 1.x's radians-to-degrees formula
  // (`(az * 180/PI + 180) % 360`) to a 2.x value that is already in degrees --
  // that corruption moves the sun to the wrong quadrant, which a quadrant-wide
  // range catches. An exact `toBe(290)` would additionally break on any suncalc
  // patch that shifts a rounded degree, failing loudly for a reason no one
  // reading the test could distinguish from the real bug.

  it('puts the sun in the east at the morning golden window (suncalc 2.x degrees, unconverted)', () => {
    const events = getSunEvents(new Date('2026-08-02T19:00:00Z'), YOSEMITE_LAT, YOSEMITE_LON);
    assertDate(events.goldenHourMorningStart);
    assertDate(events.goldenHourMorningEnd);
    const mid = new Date(
      (events.goldenHourMorningStart.getTime() + events.goldenHourMorningEnd.getTime()) / 2,
    );
    // ENE at a summer sunrise in the northern mid-latitudes.
    expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeGreaterThanOrEqual(45);
    expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeLessThanOrEqual(90);
  });

  it('puts the sun in the west at the evening golden window (mirrored)', () => {
    const events = getSunEvents(new Date('2026-08-02T19:00:00Z'), YOSEMITE_LAT, YOSEMITE_LON);
    assertDate(events.goldenHourEveningStart);
    assertDate(events.goldenHourEveningEnd);
    const mid = new Date(
      (events.goldenHourEveningStart.getTime() + events.goldenHourEveningEnd.getTime()) / 2,
    );
    // WNW: the mirror of the morning case about the 180 deg meridian.
    expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeGreaterThanOrEqual(270);
    expect(compassAzimuth(mid, YOSEMITE_LAT, YOSEMITE_LON)).toBeLessThanOrEqual(315);
  });

  it('stays an integer within [0, 360) across every minute of a full day -- 360 never appears', () => {
    // Swept, not sampled: `Math.round` on suncalc's own [0, 360) value turns
    // anything in [359.5, 360) into exactly 360, and Yosemite really does hit
    // that band (2026-08-01T08:04Z) -- a single hand-picked instant passes
    // while the contract is broken. The `% 360` in compassAzimuth is what
    // keeps this green.
    for (let minute = 0; minute < 24 * 60; minute++) {
      const at = new Date(Date.UTC(2026, 7, 1, 0, minute));
      const azimuth = compassAzimuth(at, YOSEMITE_LAT, YOSEMITE_LON);
      expect(Number.isInteger(azimuth)).toBe(true);
      expect(azimuth).toBeGreaterThanOrEqual(0);
      expect(azimuth).toBeLessThan(360);
    }
  });
});

describe('local-noon vs local-midnight input (moderate positive UTC offset regression guard)', () => {
  it('Cairo (UTC+2): local-noon input yields sunrise on the correct local date', () => {
    // Local noon Aug 1 2026 (UTC+2, no DST) = 2026-08-01T10:00:00Z.
    const localNoonUtc = new Date('2026-08-01T10:00:00Z');
    const events = getSunEvents(localNoonUtc, 30.04, 31.24);
    assertDate(events.sunrise);
    // Sunrise must fall on the same UTC calendar date as local noon's UTC date (Aug 1),
    // since Cairo's UTC+2 offset keeps sunrise within the same UTC day as local noon.
    expect(events.sunrise.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('Sydney (UTC+10): local-noon input yields sunrise on the correct local date', () => {
    // Local noon Aug 1 2026 (UTC+10, no DST in August) = 2026-08-01T02:00:00Z.
    const localNoonUtc = new Date('2026-08-01T02:00:00Z');
    const events = getSunEvents(localNoonUtc, -33.87, 151.21);
    assertDate(events.sunrise);
    // Sydney UTC+10 means local-day events land on the PREVIOUS UTC calendar
    // date; the local calendar date (via +10 conversion) must still be Aug 1.
    const localDate = new Date(events.sunrise.getTime() + 10 * 60 * 60 * 1000);
    expect(localDate.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('raw getTimes with a local-midnight input yields the PREVIOUS local date -- why the noon rule exists', () => {
    // Exercises the DEPENDENCY, not our code: the one test here that proves the
    // noon rule above is a real requirement and not superstition. Sydney
    // (UTC+10) is the harsher of the two offsets, so it stands in for both.
    // Local midnight Aug 1 2026 (UTC+10) = 2026-07-31T14:00:00Z.
    const localMidnightUtc = new Date('2026-07-31T14:00:00Z');
    const times = rawGetTimes(localMidnightUtc, -33.87, 151.21);
    expect(times.sunrise).not.toBeNull();
    const localDate = new Date((times.sunrise as Date).getTime() + 10 * 60 * 60 * 1000);
    // Previous local date (Jul 31), not Aug 1 -- a whole day of sun events off.
    expect(localDate.toISOString().slice(0, 10)).toBe('2026-07-31');
  });
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
