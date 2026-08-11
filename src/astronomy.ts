/**
 * Sun events via `suncalc`, with custom elevation-angle boundaries for
 * golden/blue hour, and polar-day/night detection.
 *
 * `getSunEvents`' doc comment carries the day-input rule, which is
 * load-bearing and fails silently.
 */
import { addTime, getPosition, getTimes } from 'suncalc';

/** Window boundaries, in degrees of solar elevation. */
export const BLUE_HOUR_LOWER = -8;
export const BLUE_HOUR_UPPER = -4;
export const GOLDEN_HOUR_LOWER = -4;
export const GOLDEN_HOUR_UPPER = 10;

// Three boundaries, not four: -4 deg is blue hour's upper bound and golden
// hour's lower bound at once -- the same elevation crossing.
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
    /** suncalc flag: sun never dips below the standard rise/set altitude that day. */
    alwaysUp: boolean;
    /** suncalc flag: sun never rises above the standard rise/set altitude that day. */
    alwaysDown: boolean;
    polar: PolarMarker;
}

function asDate(value: Date | boolean | null | undefined): Date | null {
    return value instanceof Date ? value : null;
}

const MS_PER_LONGITUDE_DEGREE = 3_600_000 / 15;

/**
 * One day's sun events for the given lat/lon. `localNoonUtc` MUST be the UTC
 * instant of that day's local noon.
 *
 * Both halves of that contract are required and fail silently. suncalc
 * derives the day's transit as `(nearest UTC noon to the input) - lon / 15
 * hours`, so it returns the neighbouring day's geometry for any input more
 * than 12 h from the intended day's UTC noon. Local midnight is 12 h off
 * before any offset is counted; bare local noon is off wherever the clock
 * offset and the longitude disagree by more than half a day (Pacific/Auckland
 * in NZDT was a full day early). Adding the longitude's own hours back hands
 * suncalc the UTC noon whose transit is the intended one, for every zone --
 * verified over 162 (location, date) pairs spanning UTC-12..+14 and both
 * longitude signs. See AGENTS.md's "Solar day" and the swept table in
 * test/astronomy.test.ts.
 *
 * suncalc contract relied on below: an uncrossed boundary is `null`, not
 * `Invalid Date`, so never check `isNaN(date.getTime())`.
 */
export function getSunEvents(localNoonUtc: Date, lat: number, lon: number): SunEvents {
    const t = getTimes(new Date(localNoonUtc.getTime() + lon * MS_PER_LONGITUDE_DEGREE), lat, lon);

    const alwaysUp = Boolean(t.alwaysUp);
    const alwaysDown = Boolean(t.alwaysDown);
    let polar: PolarMarker = null;
    if (alwaysUp) polar = 'polar-day';
    else if (alwaysDown) polar = 'polar-night';

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
 * suncalc 2.x's `azimuth` is already a compass bearing in degrees -- applying
 * the 1.x radians conversion (`(az * 180/PI + 180) % 360`) would corrupt it.
 *
 * The trailing `% 360` is not redundant: rounding anything in [359.5, 360)
 * yields exactly 360, which reads as a different compass point than the 0 it
 * means.
 */
export function compassAzimuth(date: Date, lat: number, lon: number): number {
    return Math.round(getPosition(date, lat, lon).azimuth) % 360;
}
