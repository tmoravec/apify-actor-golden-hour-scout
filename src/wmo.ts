/**
 * WMO weather-code -> human label mapping, plus a defensive superset of legacy
 * fog variants and an "Unknown"/"n/a" fallback, and the cloud-layer
 * `isIdealSky` presentation-emphasis rule.
 */

/** Open-Meteo's documented codes, plus legacy WMO fog variants (40/41/43/44/49) as a defensive superset. */
const WMO_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  // Fog (Open-Meteo documents 45/48; legacy WMO fog variants included defensively).
  40: 'Fog',
  41: 'Fog',
  43: 'Fog',
  44: 'Fog',
  45: 'Fog',
  48: 'Fog',
  49: 'Fog',
  // Drizzle (incl. freezing)
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Drizzle',
  57: 'Drizzle',
  // Rain (incl. freezing and showers)
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  66: 'Rain',
  67: 'Rain',
  80: 'Rain',
  81: 'Rain',
  82: 'Rain',
  // Snow (incl. grains and showers)
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  77: 'Snow',
  85: 'Snow',
  86: 'Snow',
  // Thunderstorm
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

/**
 * Read-only view of the code->label table, exported so downstream consumers
 * (the report footer's WMO table) can render the mapping straight from this
 * single source of truth instead of hand-duplicating it.
 */
export const WMO_LABEL_TABLE: Readonly<Record<number, string>> = WMO_LABELS;

/**
 * Maps a raw WMO weather code to its human-readable label.
 * `null` (missing variable) -> label "n/a", wmoCode null.
 * Any code outside the known table -> label "Unknown", raw code preserved.
 */
export function wmoLabel(code: number | null): { label: string; wmoCode: number | null } {
  if (code === null) {
    return { label: 'n/a', wmoCode: null };
  }
  const label = WMO_LABELS[code] ?? 'Unknown';
  return { label, wmoCode: code };
}

/**
 * Codes describing a dry, unobscured sky -- Clear / Mainly clear / Partly
 * cloudy / Overcast, i.e. the cloud-amount-only end of the table.
 *
 * `isIdealSky` uses this as a DISQUALIFIER only: anything precipitating,
 * fogged, unknown, or missing can't be ideal sky no matter what the layers
 * say. The positive case is decided entirely by the per-layer percentages
 * below, which are strictly more informative than a single summary code.
 *
 * That's a deliberate change from the earlier rule, which required the label
 * itself to be Mainly clear or Partly cloudy. Two codes it used to reject are
 * now allowed through to the layer test: "Clear" (a cloudless sky has nothing
 * to catch colour -- now excluded by the 30% high-cloud FLOOR instead, which
 * is the actual reason) and "Overcast" (which the 30-70% total-cover band
 * excludes on the numbers anyway, without needing a label special-case).
 */
const DRY_SKY_CODES = new Set([0, 1, 2, 3]);

/**
 * The ideal-sky cloud bands, in percent. ALL FOUR must hold simultaneously.
 *
 * Every band is INCLUSIVE at both ends: 60% high cloud is ideal, 61% is not.
 *
 * High cloud (cirrus/cirrostratus, ~6 km+) is the money-maker: thin and icy, it
 * catches light from below once the sun is near the horizon and turns pink,
 * orange and red. Too little and there's nothing to light up; too much and the
 * light source itself is screened off.
 *
 * Mid cloud (altocumulus/altostratus, 2-6 km) works in moderation --
 * altocumulus gives the textured mackerel-sky colour -- but solid altostratus
 * just greys everything out.
 *
 * Low cloud (stratus/stratocumulus, under 2 km) is the enemy: thick, sitting
 * right on the horizon line, blocking the low-angle light that defines golden
 * hour. Scattered at most.
 *
 * Total cover is Open-Meteo's `cloud_cover`, an INDEPENDENT whole-sky reading
 * -- NOT the sum, maximum, or any other function of the three layer figures.
 * Layers overlap and are each measured on their own 0-100% scale, so they
 * routinely sum past 100%, and a total of 45% is entirely compatible with
 * 45% high + 20% mid stacked in the same column of sky. That independence is
 * exactly why the band earns its place in the rule rather than being implied
 * by the other three: it's the one figure that says how much of the sky is
 * covered by *anything*, catching both the washed-out case the layer bands
 * would let through and the deceptively-empty one.
 *
 * Caveat worth knowing when reading the flag: Open-Meteo reports one
 * whole-sky figure per layer, with no bearing information, so this cannot ask
 * the question that actually matters for low cloud -- whether it sits on the
 * SUN-SIDE horizon specifically. A low whole-sky figure is the available proxy.
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
 * their bands at once (see `IDEAL_SKY_BANDS`): 30-60% high, 0-40% mid,
 * 0-10% low, 30-70% total.
 *
 * Any figure the forecast didn't report is `null`, which is never treated as
 * 0%: unreported means unknown, and the highlight only ever fires on evidence.
 * That makes all four REQUIRED readings -- a run missing `cloud_cover`
 * entirely (which weather.ts tolerates) yields no ideal-sky windows at all
 * rather than judging on a partial picture.
 */
export function isIdealSky(code: number | null, layers: CloudLayers): boolean {
  if (code === null || !DRY_SKY_CODES.has(code)) return false;

  return (Object.keys(IDEAL_SKY_BANDS) as Array<keyof typeof IDEAL_SKY_BANDS>).every((key) => {
    const value = layers[key];
    if (value === null) return false;
    const { min, max } = IDEAL_SKY_BANDS[key];
    return value >= min && value <= max;
  });
}
