/**
 * Builds each local day's four photography windows from astronomy output, joined
 * with hourly weather, into final dataset items.
 *
 * Entirely `now`-free: every window for every local day in the input is emitted,
 * elapsed ones included.
 */
import { compassAzimuth, getSunEvents, type SunEvents } from './astronomy.js';
import { formatIsoLocal, midpoint, overlapsHour } from './time.js';
import type { DatasetItem, GeoLocation, HourlySample, WindowItem, WindowType } from './types.js';
import { isIdealSky, wmoLabel } from './wmo.js';

/** Index of the local-noon sample within a 24-sample local-day slice. */
const NOON_INDEX = 12;

interface WindowBoundary {
    type: WindowType;
    start: Date | null;
    end: Date | null;
}

/** The four window types in chronological order, which is emission order. */
function windowBoundaries(events: SunEvents): WindowBoundary[] {
    return [
        { type: 'blueHourMorning', start: events.blueHourMorningStart, end: events.goldenHourMorningStart },
        { type: 'goldenHourMorning', start: events.goldenHourMorningStart, end: events.goldenHourMorningEnd },
        { type: 'goldenHourEvening', start: events.goldenHourEveningStart, end: events.goldenHourEveningEnd },
        { type: 'blueHourEvening', start: events.goldenHourEveningEnd, end: events.blueHourEveningEnd },
    ];
}

/** Finds the sample closest to `target`; ties (equidistant) resolve to the LATER sample. */
function findClosestSample(samples: HourlySample[], target: Date): HourlySample {
    const targetMs = target.getTime();
    let best = samples[0];
    let bestDiff = Math.abs(best.time.getTime() - targetMs);
    for (let i = 1; i < samples.length; i++) {
        const s = samples[i];
        const diff = Math.abs(s.time.getTime() - targetMs);
        if (diff < bestDiff || (diff === bestDiff && s.time.getTime() > best.time.getTime())) {
            best = s;
            bestDiff = diff;
        }
    }
    return best;
}

function buildWindowItem(
    type: WindowType,
    start: Date,
    end: Date,
    dateStr: string,
    allSamples: HourlySample[],
    location: GeoLocation,
    events: SunEvents,
): WindowItem {
    const mid = midpoint(start, end);
    const closest = findClosestSample(allSamples, mid);
    const { label, wmoCode } = wmoLabel(closest.weatherCode);

    const conditionSequence = allSamples
        .filter((s) => overlapsHour(s.time, start, end))
        .map((s) => wmoLabel(s.weatherCode).label);

    return {
        date: dateStr,
        type,
        startLocal: formatIsoLocal(start, location.timezone),
        endLocal: formatIsoLocal(end, location.timezone),
        condition: label,
        wmoCode,
        conditionSequence,
        idealSky: isIdealSky(closest.weatherCode, closest),
        conditions: {
            cloudTotal: closest.cloudTotal,
            cloudLow: closest.cloudLow,
            cloudMid: closest.cloudMid,
            cloudHigh: closest.cloudHigh,
            precipProb: closest.precipProb,
        },
        sun: {
            sunrise: events.sunrise ? formatIsoLocal(events.sunrise, location.timezone) : null,
            sunset: events.sunset ? formatIsoLocal(events.sunset, location.timezone) : null,
            azimuthAtPeak: compassAzimuth(mid, location.latitude, location.longitude),
        },
        location,
    };
}

/**
 * One local day's dataset items, from its already-computed astronomy events.
 *
 * A window is emitted iff BOTH of its boundary crossings exist that day, so a
 * partial polar day still emits whatever windows it has. A day with none emits
 * exactly one explanatory item instead of nothing, so a 7-day run always
 * represents 7 days and a missing date is never ambiguous with a dropped record:
 * a `PolarItem` when `events.polar` names the condition, otherwise a
 * `NoWindowsItem` (see its contract -- labelling that day polar would be wrong).
 *
 * PRECONDITION: `allSamples` is non-empty whenever any boundary pair is set,
 * since `findClosestSample` reads `samples[0]` unconditionally. `buildWindows`
 * guarantees this by rejecting an empty array before calling in.
 */
export function buildDayWindows(
    events: SunEvents,
    dateStr: string,
    allSamples: HourlySample[],
    location: GeoLocation,
): DatasetItem[] {
    const items: DatasetItem[] = [];

    for (const boundary of windowBoundaries(events)) {
        if (!boundary.start || !boundary.end) continue;
        items.push(buildWindowItem(boundary.type, boundary.start, boundary.end, dateStr, allSamples, location, events));
    }

    if (items.length === 0) {
        items.push(
            events.polar
                ? { date: dateStr, type: 'polar', reason: events.polar, location }
                : { date: dateStr, type: 'noWindows', reason: 'no-boundary-crossings', location },
        );
    }

    return items;
}

/**
 * All dataset items across every local day in `samples`.
 *
 * `samples.length` must be a multiple of 24; consecutive 24-sample slices are
 * local days, which holds without timezone arithmetic because Open-Meteo's
 * `timezone=auto` response starts at local midnight. Each day's astronomy comes
 * from its local-noon sample (index 12), per `getSunEvents`' input contract, and
 * that sample also fixes the item's `date` -- see `WindowItem.date` for why
 * `startLocal`/`endLocal` may carry a different one.
 *
 * Index 12 is exactly noon only within one offset: Open-Meteo reports a single
 * `utc_offset_seconds` per response, so after a DST transition it becomes 11:00
 * or 13:00. Nothing downstream needs more than "inside the intended local day",
 * since windows are placed from wall-clock strings rather than slice boundaries.
 * Pinned by `test/windows.test.ts`'s DST describe rather than left as a claim.
 */
export function buildWindows(samples: HourlySample[], location: GeoLocation): DatasetItem[] {
    if (samples.length === 0 || samples.length % 24 !== 0) {
        throw new Error(
            `buildWindows: expected a non-empty hourly sample array whose length is a multiple of 24, got ${samples.length}`,
        );
    }

    const dayCount = samples.length / 24;
    const items: DatasetItem[] = [];

    for (let day = 0; day < dayCount; day++) {
        const dayStart = day * 24;
        const noonSample = samples[dayStart + NOON_INDEX];
        const events = getSunEvents(noonSample.time, location.latitude, location.longitude);
        const dateStr = formatIsoLocal(noonSample.time, location.timezone).slice(0, 10);
        items.push(...buildDayWindows(events, dateStr, samples, location));
    }

    return items;
}
