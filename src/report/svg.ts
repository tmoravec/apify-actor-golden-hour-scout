/**
 * Inline SVG builders for the report: one daylight band per day with a
 * three-hourly hour grid plus condition-colored window bands.
 *
 * The helpers work purely off already-formatted `WindowItem` local ISO
 * strings (`startLocal`/`endLocal`/`sun.sunrise`/`sun.sunset`) -- the "HH:MM"
 * local wall-clock time is simply the substring after "T" in those strings
 * (they were produced by `formatIsoLocal`), so no further timezone math is
 * needed here.
 */
import { escapeHtml } from './escape.js';
import type { WindowItem } from '../types.js';

const TIMELINE_WIDTH = 1440; // 1 unit == 1 minute of the local day
const TIMELINE_HEIGHT = 56;
const BAND_TOP = 8;
const BAND_HEIGHT = 40;

/**
 * Band colors encode two things at once, on two channels that cannot be
 * mistaken for each other.
 *
 * HUE IS THE WINDOW TYPE, and nothing else: gold is golden hour, blue is blue
 * hour, exactly as the product names them. This is not a free choice -- in a
 * tool whose two subjects are *the* golden hour and *the* blue hour, gold and
 * blue are already spoken for, and spending them on anything else (an earlier
 * revision spent them on weather, gold for clear and blue for rain) makes a
 * blue band read as blue hour when it means rain.
 *
 * LIGHTNESS IS THE SKY: each band is washed toward a dark slate as the sky
 * closes in, so a strip reads as "how much light is left" at a glance while
 * the hue still says which window it is. Washing toward a slate rather than
 * toward black keeps even the wettest band visible against the night
 * background, and stops short of full wash so gold and blue stay apart at the
 * bottom of the ramp.
 */
const WINDOW_HUES = {
  golden: '#e8a33d',
  blue: '#5d78c4',
} as const;
type HueFamily = keyof typeof WINDOW_HUES;

/** The color a band is washed toward as the sky closes in. */
const WASH_TARGET = '#4a4854';

/** How far each sky tier washes its band toward `WASH_TARGET`. */
const TIER_WASH = [0, 0.3, 0.55, 0.75];

/**
 * Sky tiers, ordered by how much light the sky is leaving. Deliberately
 * coarse: the exact WMO label is always printed on the window's card and
 * repeated in the band's `<title>`, so this ramp only has to carry the
 * at-a-glance reading, not the full vocabulary.
 */
const SKY_TIERS: Record<string, number> = {
  Clear: 0,
  'Mainly clear': 0,
  'Partly cloudy': 1,
  Overcast: 2,
  Fog: 2,
  Drizzle: 3,
  Rain: 3,
  Snow: 3,
  Thunderstorm: 3,
};

/** Labels for the sky tiers, used to key the ramp in the footer. */
export const SKY_TIER_LABELS = [
  'Clear or mainly clear',
  'Partly cloudy',
  'Overcast or fog',
  'Drizzle, rain, snow, or thunderstorm',
];

/**
 * A condition with no tier ("n/a"/"Unknown") gets a flat neutral rather than a
 * position on the ramp: an unreported sky is not a *clear* sky, and must not
 * be able to look like one. Darker and flatter than every tier-3 band, so it
 * cannot be mistaken for the wet end of the ramp either.
 */
const UNKNOWN_COLOR = '#3a3841';

const HUE_BY_TYPE: Record<string, HueFamily> = {
  blueHourMorning: 'blue',
  blueHourEvening: 'blue',
  goldenHourMorning: 'golden',
  goldenHourEvening: 'golden',
};

function mixHex(from: string, to: string, amount: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [fr, fg, fb] = channels(from);
  const [tr, tg, tb] = channels(to);
  const blend = (a: number, b: number) =>
    Math.round(a + (b - a) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${blend(fr, tr)}${blend(fg, tg)}${blend(fb, tb)}`;
}

/** Every band color, precomputed so the footer key can show the same values the bands use. */
export const BAND_COLORS: Record<HueFamily, string[]> = {
  golden: TIER_WASH.map((wash) => mixHex(WINDOW_HUES.golden, WASH_TARGET, wash)),
  blue: TIER_WASH.map((wash) => mixHex(WINDOW_HUES.blue, WASH_TARGET, wash)),
};
export const UNKNOWN_BAND_COLOR = UNKNOWN_COLOR;

/** The fill for one window's band; shared with the card that describes the same window. */
export function bandColor(type: string, condition: string): string {
  const tier = SKY_TIERS[condition];
  if (tier === undefined) return UNKNOWN_COLOR;
  return BAND_COLORS[HUE_BY_TYPE[type] ?? 'golden'][tier];
}

/** Minutes since local midnight, read directly from a `formatIsoLocal` string's "HH:MM" substring. */
function minutesOfLocalIso(iso: string): number {
  const hh = Number(iso.slice(11, 13));
  const mm = Number(iso.slice(14, 16));
  return hh * 60 + mm;
}

/** Narrowest band still visible as a band rather than a hairline. */
const MIN_BAND_WIDTH = 2;

/**
 * Minutes from local midnight of `dayDate` to the local instant in `iso`,
 * counting past 1440 (or below 0) when `iso` falls on a different date.
 *
 * Both strings are plain YYYY-MM-DD local dates, so the day difference is a
 * UTC-anchored subtraction of two date-only instants -- no timezone math and
 * no DST exposure, since neither operand carries a wall-clock time.
 */
function minutesFromDayStart(dayDate: string, iso: string): number {
  const dayDelta = Math.round(
    (Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${dayDate}T00:00:00Z`)) / 86_400_000,
  );
  return dayDelta * TIMELINE_WIDTH + minutesOfLocalIso(iso);
}

interface BandGeometry {
  x: number;
  width: number;
  /** True when the interval extends past this day's right edge (local midnight). */
  runsPastMidnight: boolean;
}

/**
 * Places one interval on a single day's 1440-minute timeline row.
 *
 * Cross-midnight rule, which bites above ~60 deg: near the summer solstice
 * an evening golden/blue-hour window -- and sunset itself -- can end AFTER
 * local midnight while still belonging to this solar day, so its end
 * wall-clock time wraps to a SMALLER "HH:MM" than its start. Anchorage's
 * 2026-06-21 evening golden-hour window runs 21:34 to 00:46 the next date; naively
 * subtracting the two "HH:MM" readings gives 46 - 1294 = -1248, which the old
 * `Math.max(..., 2)` clamp turned into a 2-minute nub, silently shrinking a
 * 3-hour window to a speck.
 *
 * Measuring both edges from the DAY's own midnight instead makes the span
 * come out positive and true-to-length; the part beyond this row is clipped
 * at the right edge and flagged via `runsPastMidnight` so the continuation is
 * disclosed in the band's `<title>` rather than lost.
 */
function bandGeometry(dayDate: string, startIso: string, endIso: string): BandGeometry {
  const rawStart = minutesFromDayStart(dayDate, startIso);
  const rawEnd = minutesFromDayStart(dayDate, endIso);

  const x = Math.min(Math.max(rawStart, 0), TIMELINE_WIDTH - MIN_BAND_WIDTH);
  const right = Math.min(Math.max(rawEnd, 0), TIMELINE_WIDTH);

  return { x, width: Math.max(right - x, MIN_BAND_WIDTH), runsPastMidnight: rawEnd > TIMELINE_WIDTH };
}

/** Hours between hour-grid lines on the timeline (and between the labels under it). */
const AXIS_STEP_HOURS = 3;

/**
 * Labels at multiples of this many hours are the axis's backbone; the ones in
 * between are marked `.secondary` so the stylesheet can drop them on a narrow
 * screen, where 3-hourly labels collide. A divisor of the step, so the surviving
 * labels stay on gridlines.
 */
const AXIS_PRIMARY_HOURS = 6;

/** Three-hourly gridlines, drawn as thin rects so `preserveAspectRatio="none"` cannot thin them unevenly. */
function hourGridRects(): string {
  const rects: string[] = [];
  for (let hour = AXIS_STEP_HOURS; hour < 24; hour += AXIS_STEP_HOURS) {
    rects.push(`<rect class="hour-grid" x="${hour * 60}" y="0" width="2" height="${TIMELINE_HEIGHT}" />`);
  }
  return rects.join('');
}

/**
 * Renders one day's timeline: a daylight band (sunrise-sunset, if known) and
 * an hour grid, plus one rect per window, colored by window type and sky (see
 * `bandColor`) and highlighted (`.ideal-sky`) when the window is flagged ideal.
 *
 * Every band is drawn identically whether or not it has already happened: the
 * report is a record of what the light did across the whole span, and an earlier
 * revision's dimming of elapsed windows read as "this data is unreliable"
 * rather than "this is in the past".
 *
 * `date` is the solar day this row represents (every window in `dayWindows`
 * shares it); every band is positioned relative to THAT day's midnight, not
 * to its own wall-clock reading -- see `bandGeometry`.
 *
 * The x axis is squashed to the panel width by `preserveAspectRatio="none"`,
 * which would also squash every stroke, so the bands carry
 * `vector-effect="non-scaling-stroke"`: their outlines (and the dashed
 * cross-midnight edge) stay the same weight on all four sides.
 */
export function renderDayTimelineSvg(date: string, dayWindows: WindowItem[]): string {
  const daylight = dayWindows.find((w) => w.sun.sunrise && w.sun.sunset)?.sun;
  let daylightRect = '';
  if (daylight?.sunrise && daylight.sunset) {
    // Sunset too can land after local midnight at sub-polar latitudes
    // (Reykjavik, 2026-06-21: sunrise 02:55, sunset 00:04 the next date), so
    // this band needs the same day-relative treatment as the window bands.
    const { x, width, runsPastMidnight } = bandGeometry(date, daylight.sunrise, daylight.sunset);
    const classes = runsPastMidnight ? 'daylight-band runs-past-midnight' : 'daylight-band';
    daylightRect = `<rect class="${classes}" x="${x}" y="0" width="${width}" height="${TIMELINE_HEIGHT}" />`;
  }

  const bandRects = dayWindows
    .map((w) => {
      const { x, width, runsPastMidnight } = bandGeometry(date, w.startLocal, w.endLocal);

      const classes = ['window-band'];
      if (w.idealSky) classes.push('ideal-sky');
      if (runsPastMidnight) classes.push('runs-past-midnight');

      // The clipped band shows only the part falling on this row, so the
      // `<title>` carries the true end date -- the span is never silently
      // misreported, and the card below shows the same times in full.
      const continuation = runsPastMidnight ? ` · runs past midnight into ${w.endLocal.slice(0, 10)}` : '';
      const title =
        `${w.type}: ${w.startLocal.slice(11, 16)}–${w.endLocal.slice(11, 16)} · ${w.condition}${continuation}`;

      return (
        `<rect class="${classes.join(' ')}" data-window-type="${escapeHtml(w.type)}" ` +
        `x="${x}" y="${BAND_TOP}" width="${width}" height="${BAND_HEIGHT}" vector-effect="non-scaling-stroke" ` +
        `fill="${bandColor(w.type, w.condition)}">` +
        `<title>${escapeHtml(title)}</title></rect>`
      );
    })
    .join('');

  return (
    `<svg class="timeline" viewBox="0 0 ${TIMELINE_WIDTH} ${TIMELINE_HEIGHT}" preserveAspectRatio="none" ` +
    `role="img" aria-label="Daylight and photography-window timeline">` +
    `${daylightRect}${hourGridRects()}${bandRects}</svg>`
  );
}

/**
 * Hour labels for the strip under a timeline, positioned as a percentage of
 * the row's width so they track the SVG at any panel size.
 *
 * They live in HTML rather than in the SVG on purpose: the timeline stretches
 * its x axis to fit the panel, which would leave `<text>` inside it
 * horizontally squashed and unreadable at exactly the width where the labels
 * matter most. Marked `aria-hidden` because the timeline's own `<title>`
 * elements already carry the times for assistive tech.
 *
 * Every label is emitted at every width; the in-between ones carry
 * `.secondary`, which the stylesheet hides on narrow screens (see
 * `AXIS_PRIMARY_HOURS`). Thinning in CSS rather than here keeps the markup
 * width-agnostic, which matters because the report is a static file that can be
 * opened at any size after the fact.
 */
export function renderHourAxisHtml(): string {
  const marks: string[] = [];
  for (let hour = 0; hour <= 24; hour += AXIS_STEP_HOURS) {
    // The 00 and 24 labels are pinned inside the row instead of centered on
    // their tick, which would push half of each label outside the panel.
    const edge = hour === 0 ? ' start' : hour === 24 ? ' end' : '';
    const density = hour % AXIS_PRIMARY_HOURS === 0 ? '' : ' secondary';
    const left = (hour / 24) * 100;
    marks.push(
      `<span class="hour-mark${edge}${density}" style="left:${left}%">${String(hour).padStart(2, '0')}</span>`,
    );
  }
  return `<div class="hour-axis" aria-hidden="true">${marks.join('')}</div>`;
}

/** Formats a cloud-cover percentage for display, distinguishing a missing variable from 0%. */
export function formatCloudPercent(value: number | null): string {
  return value === null ? 'n/a' : `${value}%`;
}
