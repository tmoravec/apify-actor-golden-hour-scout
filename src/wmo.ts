/**
 * WMO weather code -> human label, and the cloud-layer `isIdealSky` rule.
 */

/**
 * Open-Meteo's documented codes, plus legacy WMO fog variants (40/41/43/44/49)
 * as a defensive superset. Intensity, freezing and shower variants collapse
 * into their base label on purpose -- the report needs the kind of weather, and
 * the raw code travels in the dataset for anyone who needs the rest.
 */
const WMO_LABELS: Record<number, string> = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    40: 'Fog',
    41: 'Fog',
    43: 'Fog',
    44: 'Fog',
    45: 'Fog',
    48: 'Fog',
    49: 'Fog',
    51: 'Drizzle',
    53: 'Drizzle',
    55: 'Drizzle',
    56: 'Drizzle',
    57: 'Drizzle',
    61: 'Rain',
    63: 'Rain',
    65: 'Rain',
    66: 'Rain',
    67: 'Rain',
    80: 'Rain',
    81: 'Rain',
    82: 'Rain',
    71: 'Snow',
    73: 'Snow',
    75: 'Snow',
    77: 'Snow',
    85: 'Snow',
    86: 'Snow',
    95: 'Thunderstorm',
    96: 'Thunderstorm',
    99: 'Thunderstorm',
};

/** Exported so the report footer can render the table from this one source. */
export const WMO_LABEL_TABLE: Readonly<Record<number, string>> = WMO_LABELS;

/**
 * `null` (missing variable) -> "n/a" and a null code; anything outside the table
 * -> "Unknown", raw code preserved.
 */
export function wmoLabel(code: number | null): { label: string; wmoCode: number | null } {
    if (code === null) {
        return { label: 'n/a', wmoCode: null };
    }
    const label = WMO_LABELS[code] ?? 'Unknown';
    return { label, wmoCode: code };
}

/**
 * Codes describing a dry, unobscured sky: the cloud-amount-only end of the table.
 *
 * A DISQUALIFIER only -- anything precipitating, fogged, unknown or missing
 * cannot be ideal sky whatever the layers say -- while the positive case is
 * decided entirely by the percentages below, which say more than one summary
 * code can. Hence Clear and Overcast pass through here and are ruled out on the
 * numbers instead: by the high-cloud floor (nothing to catch colour) and the
 * total-cover ceiling respectively.
 */
const DRY_SKY_CODES = new Set([0, 1, 2, 3]);

/**
 * The ideal-sky cloud bands, in percent. All four must hold simultaneously, and
 * every band is INCLUSIVE at both ends: 60% high cloud is ideal, 61% is not.
 *
 * High cloud (cirrus, ~6 km+) is the money-maker -- thin and icy, it catches
 * light from below and turns pink; too little leaves nothing to light up, too
 * much screens off the light source. Mid cloud (2-6 km) adds texture in
 * moderation and greys everything out when solid. Low cloud (under 2 km) sits on
 * the horizon line and blocks the low-angle light that defines golden hour.
 *
 * Total cover is Open-Meteo's `cloud_cover`: an INDEPENDENT whole-sky reading,
 * not the sum or maximum of the three layers, which overlap and each run on
 * their own 0-100% scale (45% total sits comfortably under 45% high plus 20%
 * mid). That independence is why it earns a band of its own rather than being
 * implied by the other three -- it is the one figure saying how much of the sky
 * is covered by anything, catching both the washed-out case and the
 * deceptively-empty one.
 *
 * Caveat when reading the flag: each figure is whole-sky with no bearing, so the
 * question that actually matters for low cloud -- whether it sits on the SUN-SIDE
 * horizon -- cannot be asked. A low whole-sky figure is the available proxy.
 */
export const IDEAL_SKY_BANDS = {
    cloudHigh: { min: 30, max: 60 },
    cloudMid: { min: 0, max: 40 },
    cloudLow: { min: 0, max: 10 },
    cloudTotal: { min: 30, max: 70 },
} as const;

/** The cloud figures a sky judgement needs; `null` = the forecast didn't report that one. */
export interface CloudLayers {
    cloudLow: number | null;
    cloudMid: number | null;
    cloudHigh: number | null;
    cloudTotal: number | null;
}

/**
 * Ideal sky = a dry, unobscured WMO code AND all four cloud figures inside
 * `IDEAL_SKY_BANDS` at once.
 *
 * An unreported figure is `null` and never read as 0%: unreported means unknown,
 * and the highlight fires only on evidence. All four are therefore required, so a
 * run missing `cloud_cover` entirely -- which `weather.ts` tolerates -- yields no
 * ideal-sky windows rather than a verdict on a partial picture.
 */
export function isIdealSky(code: number | null, layers: CloudLayers): boolean {
    if (code === null || !DRY_SKY_CODES.has(code)) return false;

    return (Object.keys(IDEAL_SKY_BANDS) as (keyof typeof IDEAL_SKY_BANDS)[]).every((key) => {
        const value = layers[key];
        if (value === null) return false;
        const { min, max } = IDEAL_SKY_BANDS[key];
        return value >= min && value <= max;
    });
}
