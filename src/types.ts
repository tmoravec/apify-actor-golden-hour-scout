/**
 * Shared type contracts used across modules, plus the one type guard
 * (`isWindowItem`) that discriminates the dataset-item union.
 */

/** A single normalized hourly weather sample (one Open-Meteo hourly slot). */
export interface HourlySample {
  /** UTC instant of this hourly sample. */
  time: Date;
  /** Raw WMO weather code for this hour, or null if the variable was missing ("n/a"). */
  weatherCode: number | null;
  // Cloud cover and precipitation probability: percent (0-100), or null if
  // that variable was missing from the response.
  cloudTotal: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  precipProb: number | null;
}

/** The four fixed photography window types: always all four, not configurable. */
export type WindowType =
  | 'blueHourMorning'
  | 'goldenHourMorning'
  | 'goldenHourEvening'
  | 'blueHourEvening';

/** Cloud/precipitation numbers behind a window's condition label. */
export interface WindowConditions {
  cloudTotal: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  precipProb: number | null;
}

/** Sun data for a window. */
export interface WindowSun {
  /** ISO-8601 local string with offset, or null on a polar day/night where the event doesn't occur. */
  sunrise: string | null;
  /** ISO-8601 local string with offset, or null on a polar day/night where the event doesn't occur. */
  sunset: string | null;
  /** Compass azimuth (degrees, north-clockwise, [0,360)) at the window's temporal midpoint. */
  azimuthAtPeak: number;
}

/** Resolved place identity, shared by geocode.ts output and each dataset item's `location` field. */
export interface GeoLocation {
  /** Composite display name: `name[, admin1][, country]` (missing parts skipped). */
  name: string;
  /** Raw admin1 (state/province) field from the geocoding API, if present. */
  admin1?: string;
  /** Raw country field from the geocoding API, if present. */
  country?: string;
  latitude: number;
  longitude: number;
  /** IANA timezone name, e.g. "America/Los_Angeles". */
  timezone: string;
}

/** One dataset item: a single photography window. */
export interface WindowItem {
  /**
   * Local calendar date of the SOLAR DAY this window belongs to, YYYY-MM-DD.
   *
   * Cross-midnight contract, which bites above ~60 deg latitude: this is the
   * date whose local-noon astronomy produced the window, NOT a restatement of
   * `startLocal`/`endLocal`'s own date. Near the summer solstice at sub-polar
   * latitudes an evening window can end -- and the following blue-hour window
   * can even start -- after local midnight, so `endLocal` (and rarely
   * `startLocal`) may carry the NEXT calendar date. Verified with suncalc for
   * Anchorage (61.22 N) on 2026-06-21, whose evening golden-hour window runs
   * 21:34:55-08:00 to 00:46:41-08:00 on 2026-06-22 while `date` stays
   * "2026-06-21".
   *
   * This grouping is deliberate: an evening window that spills past midnight
   * is still that evening's shoot, so it stays with its own day rather than
   * jumping to the next one. Consumers that need the wall-clock date of a
   * boundary must read it from `startLocal`/`endLocal`, never from `date`.
   */
  date: string;
  type: WindowType;
  /** ISO-8601 local string with UTC offset. */
  startLocal: string;
  /** ISO-8601 local string with UTC offset. */
  endLocal: string;
  /** WMO label of the hourly sample closest to the window's midpoint, or "n/a" if that sample's code is null. */
  condition: string;
  /** Raw WMO code backing `condition`, or null if that sample's code was missing. */
  wmoCode: number | null;
  /** One condition label per hour overlapping [start, end), duplicates kept. */
  conditionSequence: string[];
  /**
   * True iff the midpoint-closest sample reports a dry, unobscured sky (WMO
   * 0-3) AND all four of its cloud figures sit inside their bands at once:
   * 30-60% high, 0-40% mid, 0-10% low, 30-70% total (all inclusive). High
   * cloud to catch the colour, limited mid cloud so it isn't greyed out, a
   * near-clear horizon for the low-angle light, and a total cover that is
   * neither empty nor closed-in. See `IDEAL_SKY_BANDS` in wmo.ts.
   */
  idealSky: boolean;
  conditions: WindowConditions;
  sun: WindowSun;
  location: GeoLocation;
}

/** Explanatory item emitted for a day with zero emittable windows (polar day/night). */
export interface PolarItem {
  date: string;
  type: 'polar';
  reason: 'polar-day' | 'polar-night';
  location: GeoLocation;
}

/**
 * Explanatory item emitted for an ORDINARY (non-polar) day that still has zero
 * emittable windows.
 *
 * Reachable at sub-polar latitudes (roughly 60-66 deg) near the summer
 * solstice: the sun rises and sets normally -- `alwaysUp`/`alwaysDown` are
 * both false, so this is not a polar day -- but it never climbs past the
 * +10 deg golden-hour ceiling in the morning, nor sinks to the -4/-8 deg
 * blue-hour floors at night, so no window has BOTH of its boundary crossings.
 * Verified with suncalc for Reykjavik (64.15 N) on 2026-06-21, which reports a
 * 02:55 sunrise and a 00:04 (next-day) sunset yet null values for
 * `goldenHourMorningStart`, `goldenHourEveningEnd`, and both blue-hour bounds.
 *
 * Without this item such a day would simply be ABSENT from an otherwise
 * complete 7-day dataset, with nothing to distinguish "no windows here" from a
 * dropped record. It is deliberately NOT a `PolarItem`: calling an ordinary
 * sunrise/sunset day "polar" would be plainly wrong.
 */
export interface NoWindowsItem {
  date: string;
  type: 'noWindows';
  reason: 'no-boundary-crossings';
  location: GeoLocation;
}

/** Any item a run can push to the dataset. */
export type DatasetItem = WindowItem | PolarItem | NoWindowsItem;

/**
 * Narrows a dataset item to an actual photography window, excluding both
 * explanatory shapes. Centralized so a future item type cannot be silently
 * misread as a `WindowItem` by an open-ended `type !== 'polar'` check.
 */
export function isWindowItem(item: DatasetItem): item is WindowItem {
  return item.type !== 'polar' && item.type !== 'noWindows';
}
