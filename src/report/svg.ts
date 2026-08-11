/**
 * Inline SVG builders for the report: one daylight band per day, a three-hourly
 * grid, and condition-colored window bands.
 *
 * Everything here works off the already-formatted local ISO strings on a
 * `WindowItem`, where local wall-clock "HH:MM" is just the substring after "T",
 * so no timezone math happens in this file.
 */
import type { WindowItem } from '../types.js';
import { escapeHtml } from './escape.js';

const TIMELINE_WIDTH = 1440; // 1 unit == 1 minute of the local day
const TIMELINE_HEIGHT = 56;
const BAND_TOP = 8;
const BAND_HEIGHT = 40;

/**
 * A band encodes two things on two channels that cannot be confused.
 *
 * HUE IS THE WINDOW TYPE, and nothing else. Not a free choice: in a tool whose
 * subjects are *the* golden hour and *the* blue hour, gold and blue are spoken
 * for, and spending them on weather (as an earlier revision did) makes a blue
 * band read as blue hour when it means rain.
 *
 * LIGHTNESS IS THE SKY: bands wash toward a dark slate as the sky closes in, so a
 * strip reads as how much light is left while the hue still says which window it
 * is. Toward slate rather than black so the wettest band stays visible against
 * the night background, and stopping short of a full wash so gold and blue stay
 * apart at the bottom of the ramp.
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
 * Sky tiers, ordered by how much light the sky is leaving. Coarse on purpose:
 * the exact label is on the card and in the band's `<title>`, so the ramp only
 * carries the at-a-glance reading.
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

/** Tier names, for the footer's key. */
export const SKY_TIER_LABELS = [
    'Clear or mainly clear',
    'Partly cloudy',
    'Overcast or fog',
    'Drizzle, rain, snow, or thunderstorm',
];

/**
 * A condition with no tier ("n/a"/"Unknown") gets a flat neutral off the ramp
 * entirely: an unreported sky is not a *clear* sky and must not look like one.
 * Darker than every tier-3 band, so it cannot read as the wet end either.
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

/** Precomputed so the footer key shows the same values the bands use. */
export const BAND_COLORS: Record<HueFamily, string[]> = {
    golden: TIER_WASH.map((wash) => mixHex(WINDOW_HUES.golden, WASH_TARGET, wash)),
    blue: TIER_WASH.map((wash) => mixHex(WINDOW_HUES.blue, WASH_TARGET, wash)),
};
export const UNKNOWN_BAND_COLOR = UNKNOWN_COLOR;

/** One window's fill, shared with the card describing that window. */
export function bandColor(type: string, condition: string): string {
    const tier = SKY_TIERS[condition];
    if (tier === undefined) return UNKNOWN_COLOR;
    return BAND_COLORS[HUE_BY_TYPE[type] ?? 'golden'][tier];
}

/** Minutes since local midnight, from the string's own "HH:MM" substring. */
function minutesOfLocalIso(iso: string): number {
    const hh = Number(iso.slice(11, 13));
    const mm = Number(iso.slice(14, 16));
    return hh * 60 + mm;
}

/** Narrowest band still visible as a band rather than a hairline. */
const MIN_BAND_WIDTH = 2;

/**
 * Minutes from local midnight of `dayDate` to the local instant in `iso`,
 * counting past 1440 (or below 0) when the dates differ.
 *
 * The day difference subtracts two date-only instants anchored at UTC, so
 * neither operand carries a wall-clock time and DST cannot reach this.
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
 * Above ~60 deg an evening window -- and sunset itself -- can end after local
 * midnight while still belonging to this solar day, so its end wraps to a
 * SMALLER "HH:MM" than its start. Subtracting the two readings would then give a
 * negative span, which a `Math.max(..., 2)` clamp once turned into a 2-minute nub
 * where Anchorage had a 3-hour window (2026-06-21, 21:34 to 00:46).
 *
 * Measuring both edges from the DAY's own midnight keeps the span positive and
 * true to length. The part beyond this row is clipped and flagged
 * `runsPastMidnight`, so the continuation is disclosed rather than lost.
 */
function bandGeometry(dayDate: string, startIso: string, endIso: string): BandGeometry {
    const rawStart = minutesFromDayStart(dayDate, startIso);
    const rawEnd = minutesFromDayStart(dayDate, endIso);

    const x = Math.min(Math.max(rawStart, 0), TIMELINE_WIDTH - MIN_BAND_WIDTH);
    const right = Math.min(Math.max(rawEnd, 0), TIMELINE_WIDTH);

    return { x, width: Math.max(right - x, MIN_BAND_WIDTH), runsPastMidnight: rawEnd > TIMELINE_WIDTH };
}

/** Hours between gridlines, and between the labels under them. */
const AXIS_STEP_HOURS = 3;

/**
 * The axis's backbone: labels off these multiples are marked `.secondary` for
 * the stylesheet to drop where 3-hourly labels collide. A multiple of the step,
 * so the surviving labels stay on gridlines.
 */
const AXIS_PRIMARY_HOURS = 6;

/** Rects rather than lines, so `preserveAspectRatio="none"` cannot thin them unevenly. */
function hourGridRects(): string {
    const rects: string[] = [];
    for (let hour = AXIS_STEP_HOURS; hour < 24; hour += AXIS_STEP_HOURS) {
        rects.push(`<rect class="hour-grid" x="${hour * 60}" y="0" width="2" height="${TIMELINE_HEIGHT}" />`);
    }
    return rects.join('');
}

/**
 * One day's timeline: a daylight band and an hour grid, plus one rect per window.
 *
 * Elapsed bands draw exactly like upcoming ones -- an earlier revision dimmed
 * them, which read as "this data is unreliable" rather than "this is past".
 *
 * `date` is the solar day this row represents, shared by every window in
 * `dayWindows`, and every band is positioned relative to THAT day's midnight
 * rather than to its own wall-clock reading -- see `bandGeometry`.
 *
 * `preserveAspectRatio="none"` squashes the x axis to the panel width, strokes
 * included, so the bands carry `vector-effect="non-scaling-stroke"` to keep their
 * outlines even on all four sides.
 */
export function renderDayTimelineSvg(date: string, dayWindows: WindowItem[]): string {
    const daylight = dayWindows.find((w) => w.sun.sunrise && w.sun.sunset)?.sun;
    let daylightRect = '';
    if (daylight?.sunrise && daylight.sunset) {
        // Sunset too can land after local midnight (Reykjavik, 2026-06-21: rise
        // 02:55, set 00:04 the next date), so the daylight band needs the same
        // day-relative treatment as the window bands.
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

            // A clipped band shows only the part on this row, so the `<title>`
            // carries the true end date rather than misreporting the span.
            const continuation = runsPastMidnight ? ` · runs past midnight into ${w.endLocal.slice(0, 10)}` : '';
            const title = `${w.type}: ${w.startLocal.slice(11, 16)}–${w.endLocal.slice(11, 16)} · ${w.condition}${continuation}`;

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
 * Hour labels for the strip under a timeline, placed as a percentage of the
 * row's width so they track the SVG at any panel size.
 *
 * In HTML rather than in the SVG because the timeline stretches its x axis to
 * fit, which would leave `<text>` squashed and unreadable at exactly the width
 * where the labels matter most. `aria-hidden`, since the bands' own `<title>`
 * elements already carry the times.
 *
 * Every label is emitted at every width and the in-between ones are thinned in
 * CSS (see `AXIS_PRIMARY_HOURS`), keeping the markup width-agnostic -- the report
 * is a static file that can be opened at any size after the fact.
 */
export function renderHourAxisHtml(): string {
    const marks: string[] = [];
    for (let hour = 0; hour <= 24; hour += AXIS_STEP_HOURS) {
        // 00 and 24 are pinned inside the row; centering them on their tick would
        // push half of each label outside the panel.
        let edge = '';
        if (hour === 0) edge = ' start';
        else if (hour === 24) edge = ' end';
        const density = hour % AXIS_PRIMARY_HOURS === 0 ? '' : ' secondary';
        const left = (hour / 24) * 100;
        marks.push(
            `<span class="hour-mark${edge}${density}" style="left:${left}%">${String(hour).padStart(2, '0')}</span>`,
        );
    }
    return `<div class="hour-axis" aria-hidden="true">${marks.join('')}</div>`;
}

/**
 * A forecast percentage for display, keeping a variable the forecast did not
 * report distinct from a real 0%.
 */
export function formatForecastPercent(value: number | null): string {
    return value === null ? 'n/a' : `${value}%`;
}
