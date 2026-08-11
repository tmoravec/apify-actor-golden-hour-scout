/**
 * Shared type contracts, plus the one type guard (`isWindowItem`) that
 * discriminates the dataset-item union.
 */

/** One normalized Open-Meteo hourly slot. */
export interface HourlySample {
    /** UTC instant. */
    time: Date;
    /** Raw WMO code, or null if the variable was missing ("n/a"). */
    weatherCode: number | null;
    // Cloud cover and precipitation probability: percent (0-100), or null where
    // the response omitted that variable.
    cloudTotal: number | null;
    cloudLow: number | null;
    cloudMid: number | null;
    cloudHigh: number | null;
    precipProb: number | null;
}

/** The photography window types: always all four, not configurable. */
export type WindowType = 'blueHourMorning' | 'goldenHourMorning' | 'goldenHourEvening' | 'blueHourEvening';

/** Cloud/precipitation numbers behind a window's condition label. */
export interface WindowConditions {
    cloudTotal: number | null;
    cloudLow: number | null;
    cloudMid: number | null;
    cloudHigh: number | null;
    precipProb: number | null;
}

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

/**
 * A resolved target ahead of the forecast call: a `GeoLocation` whose timezone
 * is not settled yet. Both producers can be in that state -- `geocode` when the
 * result carries no `timezone` field, and `resolveTarget`'s `coordinates` path,
 * which has no place record to read one from. `resolveLocation` settles it from
 * the forecast's `timezone=auto` read-back, or fails the run.
 *
 * Here rather than in `target.ts` so `geocode.ts` can name it without importing
 * from its own caller.
 */
export type TargetLocation = Omit<GeoLocation, 'timezone'> & { timezone: string | null };

/** One dataset item: a single photography window. */
export interface WindowItem {
    /**
     * Local calendar date of the SOLAR DAY this window belongs to, YYYY-MM-DD:
     * the date whose local-noon astronomy produced the window, not a restatement
     * of `startLocal`/`endLocal`'s own date.
     *
     * Above ~60 deg an evening window near the solstice can end after local
     * midnight, so `endLocal` may carry the NEXT date -- Anchorage (61.22 N) on
     * 2026-06-21 runs 21:34:55-08:00 to 00:46:41-08:00 while `date` stays
     * "2026-06-21". That grouping is deliberate: an evening shoot spilling past
     * midnight still belongs to that evening. Consumers needing a boundary's
     * wall-clock date must read `startLocal`/`endLocal`, never `date`.
     *
     * `startLocal` crossing the same way is theoretical: a sweep of 40-68 deg
     * across June 2026 found no case, the geometry being self-limiting -- by that
     * latitude the day has usually become `noWindows` already.
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
     * 0-3) AND all four of its cloud figures sit inside their bands at once.
     * `IDEAL_SKY_BANDS` (wmo.ts) holds the thresholds and the reasoning.
     */
    idealSky: boolean;
    conditions: WindowConditions;
    sun: WindowSun;
    location: GeoLocation;
}

/** Explanatory item for a day with zero windows because of polar day/night. */
export interface PolarItem {
    date: string;
    type: 'polar';
    reason: 'polar-day' | 'polar-night';
    location: GeoLocation;
}

/**
 * Explanatory item for an ORDINARY day that still has zero windows.
 *
 * Real at 60-66 deg near the summer solstice: the sun rises and sets normally,
 * but never climbs past the +10 deg ceiling in the morning nor sinks to the
 * -4/-8 deg floors at night, so no window has BOTH boundary crossings.
 * Reykjavik (64.15 N) on 2026-06-21 has a 02:55 sunrise and a 00:04 next-day
 * sunset with every custom boundary null.
 *
 * Emitted so such a day is not simply absent from an otherwise complete 7-day
 * dataset, indistinguishable from a dropped record. Deliberately not a
 * `PolarItem`: `alwaysUp`/`alwaysDown` are both false here, so calling it polar
 * would be factually wrong.
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
 * Narrows a dataset item to an actual photography window. Centralized so a
 * future item type cannot be silently misread as a `WindowItem` by an
 * open-ended `type !== 'polar'` check.
 */
export function isWindowItem(item: DatasetItem): item is WindowItem {
    return item.type !== 'polar' && item.type !== 'noWindows';
}

/**
 * Every key that appears on some `DatasetItem` shape, used to hold
 * `.actor/dataset_schema.json`'s fields to real ones. `satisfies` makes a typo
 * or a renamed field fail `tsc`, not just a test.
 */
export const DATASET_ITEM_KEYS = [
    'date',
    'type',
    'startLocal',
    'endLocal',
    'condition',
    'wmoCode',
    'conditionSequence',
    'idealSky',
    'conditions',
    'sun',
    'location',
    'reason',
] as const satisfies readonly (keyof WindowItem | keyof PolarItem | keyof NoWindowsItem)[];

/**
 * Every value a dataset item's `type` and `reason` can take, backing the
 * assertions that `.actor/dataset_schema.json`'s `enum`s match the code.
 *
 * `Record<Union, true>` rather than a `satisfies` tuple because a record literal
 * keyed by a union is exhaustive in both directions -- a missing member fails
 * `tsc` too. A tuple would let a newly added window type go unlisted, which is
 * exactly the drift worth catching.
 */
const DATASET_ITEM_TYPE_SET: Record<DatasetItem['type'], true> = {
    blueHourMorning: true,
    goldenHourMorning: true,
    goldenHourEvening: true,
    blueHourEvening: true,
    polar: true,
    noWindows: true,
};

const DATASET_ITEM_REASON_SET: Record<PolarItem['reason'] | NoWindowsItem['reason'], true> = {
    'polar-day': true,
    'polar-night': true,
    'no-boundary-crossings': true,
};

export const DATASET_ITEM_TYPES = Object.keys(DATASET_ITEM_TYPE_SET) as DatasetItem['type'][];

export const DATASET_ITEM_REASONS = Object.keys(DATASET_ITEM_REASON_SET) as (
    PolarItem['reason'] | NoWindowsItem['reason']
)[];
