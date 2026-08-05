import { describe, it, expect } from 'vitest';
import { isWindowItem } from '../src/types.js';
import type { GeoLocation, WindowItem, PolarItem, NoWindowsItem } from '../src/types.js';

// `isWindowItem` is small but a lot rests on it: `main.ts`'s nextIdealSky
// filter and `render.ts`'s day sections both narrow through it, and both would
// silently misread an explanatory item as a window if it drifted. Pinned here
// rather than only incidentally through the callers' own tests.

const LOCATION: GeoLocation = {
  name: 'Test Place',
  latitude: 37.7456,
  longitude: -119.5936,
  timezone: 'America/Los_Angeles',
};

const WINDOW: WindowItem = {
  date: '2026-08-01',
  type: 'goldenHourEvening',
  startLocal: '2026-08-01T20:31:00-07:00',
  endLocal: '2026-08-01T21:26:00-07:00',
  condition: 'Partly cloudy',
  wmoCode: 2,
  conditionSequence: ['Partly cloudy'],
  idealSky: true,
  conditions: { cloudTotal: 42, cloudLow: 2, cloudMid: 11, cloudHigh: 38, precipProb: 5 },
  sun: { sunrise: '2026-08-01T06:03:00-07:00', sunset: '2026-08-01T20:11:00-07:00', azimuthAtPeak: 290 },
  location: LOCATION,
};

const POLAR: PolarItem = {
  date: '2026-06-21',
  type: 'polar',
  reason: 'polar-day',
  location: LOCATION,
};

const NO_WINDOWS: NoWindowsItem = {
  date: '2026-06-21',
  type: 'noWindows',
  reason: 'no-boundary-crossings',
  location: LOCATION,
};

describe('isWindowItem', () => {
  it('accepts an actual window item', () => {
    expect(isWindowItem(WINDOW)).toBe(true);
  });

  it.each([
    ['polar', POLAR],
    // The one the guard exists for: an open-ended `type !== "polar"` check
    // would let this through, and a noWindows item has no startLocal/idealSky
    // for the consumers that would then read them.
    ['noWindows', NO_WINDOWS],
  ])('rejects the %s explanatory item', (_label, item) => {
    expect(isWindowItem(item)).toBe(false);
  });
});
