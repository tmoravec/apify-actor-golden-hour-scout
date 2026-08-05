/**
 * Sun-event computation via `suncalc`, with custom elevation-angle boundaries
 * for golden/blue hour and polar-day/night detection.
 *
 * Import shape (runtime-verified, do not change): suncalc@2.0.1 is pure ESM
 * with named exports only. `import SunCalc from 'suncalc'` fails both at
 * runtime (Node ESM: no export named 'default') and at typecheck (TS1192) --
 * never use a default import.
 *
 * CRITICAL day-input rule (runtime-verified; the wrong instant fails silently):
 * `getTimes` day-bounds by the UTC calendar date of its input instant, not the
 * local solar day. The instant passed to `getSunEvents` below MUST be that day's
 * LOCAL NOON, never local midnight -- at UTC+1..+12 offsets, local midnight
 * falls in the previous UTC calendar date and silently yields the previous
 * local day's sun events. Local noon always shares its UTC calendar date
 * with the day's actual solar events in the non-polar case. See
 * tests/astronomy.test.ts's Cairo/Sydney regression guard.
 */
import { addTime, getTimes, getPosition } from 'suncalc';

/** Blue hour: solar elevation -8 deg to -4 deg. */
export const BLUE_HOUR_LOWER = -8;
export const BLUE_HOUR_UPPER = -4;
/** Golden hour: solar elevation -4 deg to +10 deg. */
export const GOLDEN_HOUR_LOWER = -4;
export const GOLDEN_HOUR_UPPER = 10;

// Register the three custom elevation-angle boundaries once, at module load.
// The -4 deg boundary is shared: it is simultaneously blue hour's upper bound
// and golden hour's lower bound (the same instant, one elevation crossing).
addTime(BLUE_HOUR_LOWER, 'blueHourMorningStart', 'blueHourEveningEnd');
addTime(BLUE_HOUR_UPPER, 'goldenHourMorningStart', 'goldenHourEveningEnd');
addTime(GOLDEN_HOUR_UPPER, 'goldenHourMorningEnd', 'goldenHourEveningStart');

export type PolarMarker = 'polar-day' | 'polar-night' | null;

export interface SunEvents {
  /** -8 deg ascending (morning): blue hour begins. */
  blueHourMorningStart: Date | null;
  /** -4 deg ascending (morning): blue hour ends, golden hour begins. */
  goldenHourMorningStart: Date | null;
  /** Standard sunrise (~-0.833 deg ascending). */
  sunrise: Date | null;
  /** +10 deg ascending (morning): golden hour ends. */
  goldenHourMorningEnd: Date | null;
  /** +10 deg descending (evening): golden hour begins. */
  goldenHourEveningStart: Date | null;
  /** Standard sunset (~-0.833 deg descending). */
  sunset: Date | null;
  /** -4 deg descending (evening): golden hour ends, blue hour begins. */
  goldenHourEveningEnd: Date | null;
  /** -8 deg descending (evening): blue hour ends. */
  blueHourEveningEnd: Date | null;
  /** suncalc 2.x flag: Sun never dips below the standard rise/set altitude that day. */
  alwaysUp: boolean;
  /** suncalc 2.x flag: Sun never rises above the standard rise/set altitude that day. */
  alwaysDown: boolean;
  /** Convenience marker derived from alwaysUp/alwaysDown, or null on an ordinary day. */
  polar: PolarMarker;
}

/** Narrows a suncalc custom-time value (Date | boolean | null | undefined) to Date | null. */
function asDate(value: Date | boolean | null | undefined): Date | null {
  return value instanceof Date ? value : null;
}

/**
 * Computes one day's sun events (standard + custom golden/blue-hour
 * boundaries) for the given lat/lon.
 *
 * `localNoonUtc` MUST be the UTC instant of that day's LOCAL NOON (see module
 * doc comment) -- never local midnight, and never an arbitrary instant from
 * elsewhere in the day.
 *
 * suncalc 2.x contract, relied on below: a boundary never crossed that day is
 * `null` (not `Invalid Date`); `alwaysUp`/`alwaysDown` name the polar
 * condition. Never check `isNaN(date.getTime())`.
 */
export function getSunEvents(localNoonUtc: Date, lat: number, lon: number): SunEvents {
  const t = getTimes(localNoonUtc, lat, lon);

  const alwaysUp = Boolean(t.alwaysUp);
  const alwaysDown = Boolean(t.alwaysDown);
  const polar: PolarMarker = alwaysUp ? 'polar-day' : alwaysDown ? 'polar-night' : null;

  return {
    blueHourMorningStart: asDate(t.blueHourMorningStart),
    goldenHourMorningStart: asDate(t.goldenHourMorningStart),
    sunrise: asDate(t.sunrise),
    goldenHourMorningEnd: asDate(t.goldenHourMorningEnd),
    goldenHourEveningStart: asDate(t.goldenHourEveningStart),
    sunset: asDate(t.sunset),
    goldenHourEveningEnd: asDate(t.goldenHourEveningEnd),
    blueHourEveningEnd: asDate(t.blueHourEveningEnd),
    alwaysUp,
    alwaysDown,
    polar,
  };
}

/**
 * Compass azimuth (degrees, north-clockwise, [0, 360)) of the sun at `date`.
 *
 * suncalc 2.x's `getPosition().azimuth` is ALREADY a compass bearing in
 * degrees -- do NOT apply the 1.x radians-to-degrees conversion formula
 * (`(az * 180/PI + 180) % 360`), which would corrupt this value.
 *
 * The trailing `% 360` is not redundant: suncalc's own value is [0, 360), but
 * rounding anything in [359.5, 360) yields exactly 360, which is outside the
 * documented range and reads as a different compass point than the 0 it means.
 */
export function compassAzimuth(date: Date, lat: number, lon: number): number {
  return Math.round(getPosition(date, lat, lon).azimuth) % 360;
}
