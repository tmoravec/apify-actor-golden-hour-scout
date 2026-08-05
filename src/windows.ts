/**
 * Builds the 4 fixed photography-window types per local day from astronomy
 * output, joined with hourly weather, producing final dataset items.
 *
 * This module is entirely `now`-free: it never constructs `new Date()` and
 * never filters out "past" windows -- it emits all windows for all local days
 * present in the input. Past-window handling is main.ts/report's job.
 */
import { getSunEvents, compassAzimuth, type SunEvents } from './astronomy.js';
import { formatIsoLocal, midpoint, overlapsHour } from './time.js';
import { wmoLabel, isIdealSky } from './wmo.js';
import type { HourlySample, GeoLocation, WindowItem, DatasetItem, WindowType } from './types.js';

const DAY_SIZE = 24;
/** Index of the local-noon sample within a 24-sample local-day slice. */
const NOON_INDEX = 12;

interface WindowBoundary {
  type: WindowType;
  start: Date | null;
  end: Date | null;
}

/** Ordered boundary definitions for the 4 fixed window types. */
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
 * Builds the dataset items for a single local day, given its already-computed
 * astronomy events (synthetic or real), the full hourly-sample array to join
 * against, and the resolved location.
 *
 * A window is emitted iff BOTH of its boundary crossings exist that day
 * (partial polar days near the polar circle still emit whatever windows
 * exist).
 *
 * A day with zero emittable windows NEVER emits an empty day -- it always
 * produces exactly one explanatory item, so a 7-day run always yields 7
 * represented days and a missing date is never ambiguous with a dropped
 * record. Which explanation depends on `events.polar`:
 * - polar day/night (`alwaysUp`/`alwaysDown`): a `PolarItem` naming which.
 * - an ordinary sunrise/sunset day whose custom boundaries simply are not all
 *   crossed -- real at 60-66 deg near the solstice, see `NoWindowsItem`'s
 *   contract -- a `NoWindowsItem`. Labelling this one "polar" would be wrong.
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
 * Builds all dataset items across every local day present in `samples`.
 *
 * `samples` must be an array whose length is a multiple of 24; consecutive
 * 24-sample slices are treated as local days (Open-Meteo's `timezone=auto`
 * response starts at local midnight, so this holds without any timezone
 * arithmetic here). Each day's astronomy is computed from that day's
 * local-noon sample (index 12) per astronomy.ts's input contract.
 *
 * That noon sample also fixes each item's `date` -- see `WindowItem.date`'s
 * cross-midnight contract for why a window's own `startLocal`/`endLocal` may
 * carry a different calendar date at high latitudes.
 */
export function buildWindows(samples: HourlySample[], location: GeoLocation): DatasetItem[] {
  if (samples.length === 0 || samples.length % DAY_SIZE !== 0) {
    throw new Error(
      `buildWindows: expected a non-empty hourly sample array whose length is a multiple of ${DAY_SIZE}, got ${samples.length}`,
    );
  }

  const dayCount = samples.length / DAY_SIZE;
  const items: DatasetItem[] = [];

  for (let day = 0; day < dayCount; day++) {
    const dayStart = day * DAY_SIZE;
    const noonSample = samples[dayStart + NOON_INDEX];
    const events = getSunEvents(noonSample.time, location.latitude, location.longitude);
    const dateStr = formatIsoLocal(noonSample.time, location.timezone).slice(0, 10);
    items.push(...buildDayWindows(events, dateStr, samples, location));
  }

  return items;
}
