/**
 * Self-contained HTML report generator: inline CSS and SVG only, the Open-Meteo
 * attribution link in the footer being the one permitted external reference.
 *
 * A pure function of the items alone, so nothing on the page depends on when it
 * was rendered and elapsed windows draw exactly like upcoming ones.
 */
import type { DatasetItem, GeoLocation, NoWindowsItem, PolarItem, WindowItem, WindowType } from '../types.js';
import { isWindowItem } from '../types.js';
import { IDEAL_SKY_BANDS, WMO_LABEL_TABLE } from '../wmo.js';
import { escapeHtml } from './escape.js';
import { REPORT_CSS } from './styles.js';
import {
    BAND_COLORS,
    bandColor,
    formatForecastPercent,
    renderDayTimelineSvg,
    renderHourAxisHtml,
    SKY_TIER_LABELS,
    UNKNOWN_BAND_COLOR,
} from './svg.js';

export interface ReportMeta {
    location: GeoLocation;
}

/** Items by `date`, the dates sorted ascending. */
function groupByDate(items: DatasetItem[]): Map<string, DatasetItem[]> {
    const grouped = new Map<string, DatasetItem[]>();
    for (const item of items) {
        const bucket = grouped.get(item.date);
        if (bucket) bucket.push(item);
        else grouped.set(item.date, [item]);
    }
    return new Map(
        [...grouped.entries()].sort(([a], [b]) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        }),
    );
}

function renderHeader(location: GeoLocation, dates: string[]): string {
    const first = dates[0] ?? '';
    const last = dates[dates.length - 1] ?? '';
    const range = first === last ? first : `${first} – ${last}`;
    return (
        `<header class="report-header">` +
        `<p class="kicker">Golden Hour Scout</p>` +
        `<h1>${escapeHtml(location.name)}</h1>` +
        `<p class="date-range">${escapeHtml(range)}</p>` +
        `</header>`
    );
}

function renderPolarBanner(item: PolarItem): string {
    const isDay = item.reason === 'polar-day';
    const title = isDay ? 'Polar day' : 'Polar night';
    const explanation = isDay
        ? 'the sun never sets below the horizon today at this location, so there is no sunset, sunrise, golden hour, or blue hour to report.'
        : 'the sun never rises above the horizon today at this location, so there is no sunrise, sunset, golden hour, or blue hour to report.';
    return (
        `<div class="polar-banner">` +
        `<p class="polar-title">${escapeHtml(item.date)} — ${title}: no photography windows today</p>` +
        `<p>${escapeHtml(explanation)}</p>` +
        `</div>`
    );
}

/**
 * Banner for an ordinary day that produced no windows -- the sub-polar summer
 * case. Worded so it cannot be mistaken for a polar day: the sun rises here.
 */
function renderNoWindowsBanner(item: NoWindowsItem): string {
    return (
        `<div class="polar-banner no-windows-banner">` +
        `<p class="polar-title">${escapeHtml(item.date)} — no photography windows today</p>` +
        `<p>The sun rises and sets on this date, but it never climbs past the golden-hour ceiling in the ` +
        `morning nor sinks to the blue-hour range at night, so no golden- or blue-hour window completes. ` +
        `This happens close to the summer solstice at high latitudes, where twilight lasts all night.</p>` +
        `</div>`
    );
}

/** Display names; the raw keys stay in `data-window-type`. */
const WINDOW_LABELS: Record<WindowType, string> = {
    blueHourMorning: 'Blue hour · morning',
    goldenHourMorning: 'Golden hour · morning',
    goldenHourEvening: 'Golden hour · evening',
    blueHourEvening: 'Blue hour · evening',
};

/**
 * A window's three cloud-layer figures plus the total, as a labeled readout --
 * numbers only, no bar: three *independent* 0-100% measurements do not compose
 * into parts of a whole, which is the one thing a stacked bar is good at saying.
 *
 * Layers run high-to-low, as they sit in the sky. Total is ruled off below them
 * rather than listed as a fourth peer, since it is a separate whole-sky reading
 * and not the column's sum. It is on the card at all because the ideal-sky rule
 * tests it, so a card without it could not explain its own ★.
 */
function renderCloudKey(w: WindowItem): string {
    const rows = (
        [
            ['high', w.conditions.cloudHigh, ''],
            ['mid', w.conditions.cloudMid, ''],
            ['low', w.conditions.cloudLow, ''],
            ['total', w.conditions.cloudTotal, ' class="cloud-total"'],
        ] as const
    )
        .map(([label, value, attrs]) => `<li${attrs}>${label}<b>${escapeHtml(formatForecastPercent(value))}</b></li>`)
        .join('');
    return (
        `<div class="wc-cloud">` +
        // Labeled because "high / mid / low" alone never says cloud.
        `<p class="wc-cloud-label">Cloud cover</p>` +
        `<ul class="cloud-key">${rows}</ul>` +
        `</div>`
    );
}

/**
 * The midpoint hour's precipitation probability, below the cloud figures rather
 * than as a fifth row in them: a likelihood is not a share of the sky, and that
 * column would invite reading it as cover.
 *
 * On the card because it is the one figure that can contradict what the card
 * otherwise shows -- `condition` and `idealSky` come from the midpoint hour's WMO
 * code, which says whether precipitation is falling *at that hour* and nothing
 * about the hour after, so a window can be ★ on a dry code with a 70% chance of
 * rain around it.
 */
function renderPrecipProb(w: WindowItem): string {
    return (
        `<p class="wc-precip">Chance of precipitation` +
        `<b>${escapeHtml(formatForecastPercent(w.conditions.precipProb))}</b></p>`
    );
}

/**
 * One card per window. Its left edge repeats the band's color, which is what
 * ties it back to the timeline -- the bands are far too narrow at panel width to
 * be labeled in place.
 */
function renderWindowCard(w: WindowItem): string {
    const classes = ['window-card'];
    if (w.idealSky) classes.push('ideal');

    // A window ending on the next date is clipped at the timeline's right edge,
    // so the card has to say so in the times themselves.
    const nextDay =
        w.endLocal.slice(0, 10) !== w.startLocal.slice(0, 10) ? `<span class="wc-next-day">+1 day</span>` : '';
    const ideal = w.idealSky ? `<span class="wc-ideal">★ ideal sky</span>` : '';

    return (
        `<article class="${classes.join(' ')}" style="--band:${bandColor(w.type, w.condition)}">` +
        `<p class="wc-type">${escapeHtml(WINDOW_LABELS[w.type])}</p>` +
        `<p class="wc-time">${escapeHtml(w.startLocal.slice(11, 16))}–${escapeHtml(w.endLocal.slice(11, 16))}${nextDay}</p>` +
        `<p class="wc-cond">${escapeHtml(w.condition)}${ideal}</p>${renderCloudKey(w)}${renderPrecipProb(w)}</article>`
    );
}

/** Names the daylight band, otherwise an unexplained shaded region. */
function renderDaylightNote(windows: WindowItem[]): string {
    const sun = windows.find((w) => w.sun.sunrise && w.sun.sunset)?.sun;
    if (!sun?.sunrise || !sun.sunset) return '';
    const range = `${sun.sunrise.slice(11, 16)}–${sun.sunset.slice(11, 16)}`;
    return `<p class="day-meta"><span class="daylight-key"></span>Daylight ${escapeHtml(range)}</p>`;
}

function renderDaySection(date: string, windows: WindowItem[]): string {
    const cards = windows.map((w) => renderWindowCard(w)).join('');
    return (
        `<section class="day-section">` +
        `<h2>${escapeHtml(date)}</h2>${renderDaylightNote(
            windows,
        )}<div class="timeline-wrap">${renderDayTimelineSvg(date, windows)}${renderHourAxisHtml()}</div>` +
        `<div class="window-grid">${cards}</div>` +
        `</section>`
    );
}

/** The footer's code table, grouped by label straight from `wmo.ts`. */
function buildWmoTableRows(): string {
    const byLabel = new Map<string, number[]>();
    for (const [codeStr, label] of Object.entries(WMO_LABEL_TABLE)) {
        const code = Number(codeStr);
        const codes = byLabel.get(label);
        if (codes) codes.push(code);
        else byLabel.set(label, [code]);
    }
    const rows = [...byLabel.entries()]
        .map(([label, codes]) => ({ label, codes: codes.sort((a, b) => a - b) }))
        .sort((a, b) => a.codes[0] - b.codes[0]);

    return rows.map((row) => `<tr><td>${row.codes.join(', ')}</td><td>${escapeHtml(row.label)}</td></tr>`).join('');
}

/**
 * The band color key, showing the exact fills the bands use. A grid because the
 * encoding is two-dimensional -- hue and wash are read together, and a flat
 * legend would have to drop an axis or list eight unexplained swatches.
 */
function renderBandKey(): string {
    const rows = SKY_TIER_LABELS.map(
        (label, tier) =>
            `<tr><td>${escapeHtml(label)}</td>` +
            `<td><span class="band-swatch" style="background:${BAND_COLORS.golden[tier]}"></span></td>` +
            `<td><span class="band-swatch" style="background:${BAND_COLORS.blue[tier]}"></span></td></tr>`,
    ).join('');
    const unknown =
        `<tr><td>Not reported</td>` +
        `<td colspan="2"><span class="band-swatch" style="background:${UNKNOWN_BAND_COLOR}"></span></td></tr>`;

    return (
        `<div class="table-scroll"><table class="wmo-table band-key">` +
        `<thead><tr><th>Sky</th><th>Golden hour</th><th>Blue hour</th></tr></thead>` +
        `<tbody>${rows}${unknown}</tbody></table></div>`
    );
}

/** Cloud-figure names for the ideal-sky band table. */
const BAND_ROW_LABELS: Record<keyof typeof IDEAL_SKY_BANDS, string> = {
    cloudHigh: 'High (cirrus, ~6 km+)',
    cloudMid: 'Mid (altocumulus, 2–6 km)',
    cloudLow: 'Low (stratus, under 2 km)',
    cloudTotal: 'Total (whole sky)',
};

/**
 * Rendered straight from `IDEAL_SKY_BANDS` rather than retyped as prose, so the
 * page cannot state a threshold the code does not apply.
 */
function renderIdealSkyBandTable(): string {
    const rows = (Object.keys(BAND_ROW_LABELS) as (keyof typeof IDEAL_SKY_BANDS)[])
        .map((key) => {
            const { min, max } = IDEAL_SKY_BANDS[key];
            return `<tr><td>${escapeHtml(BAND_ROW_LABELS[key])}</td><td>${min}&ndash;${max}%</td></tr>`;
        })
        .join('');
    return (
        `<div class="table-scroll"><table class="wmo-table">` +
        `<thead><tr><th>Cloud</th><th>Ideal band</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`
    );
}

function renderFooter(): string {
    return (
        `<footer class="report-footer">` +
        `<h3>Reading a day</h3>` +
        `<p>Each day's strip is one local midnight-to-midnight span, labeled in hours along the bottom. ` +
        `The shaded region is daylight (sunrise to sunset); the four solid bands are the photography ` +
        `windows. Every band is described in full by the card beneath it, whose left edge repeats the ` +
        `band's color.</p>` +
        `<h3>Band colors</h3>` +
        `<p>A band says two things at once. Its <strong>hue is the window</strong> &mdash; gold for the ` +
        `golden hours around sunrise and sunset, blue for the blue hours just outside them &mdash; and ` +
        `nothing else is ever drawn in those two colors. Its <strong>lightness is the sky</strong>: the ` +
        `band is washed toward grey as the sky closes in, so a vivid band is open sky and a flat, grey ` +
        `one is overcast or wet. A week of strips can therefore be scanned for good light without ` +
        `reading a single card.</p>` +
        `<p>The wash is a four-step summary; the exact condition is always printed on the window's card. ` +
        `Nothing here rates a window beyond what the sky is doing &mdash; the ★ ideal-sky outline is the ` +
        `only judgement the report makes.</p>${renderBandKey()}<h3>Cloud cover</h3>` +
        `<p>Each card lists the high, mid, and low cloud cover reported for the window's midpoint hour, with ` +
        `the total ruled off beneath them. All four are <strong>independent measurements</strong>, each on its ` +
        `own 0&ndash;100% scale. The three layers are not shares of one total and routinely sum past 100% ` +
        `&mdash; 60% high cloud over 60% low cloud is an ordinary reading, not a contradiction &mdash; and the ` +
        `total is its own whole-sky figure, not their sum: layers overlap, so 45% total sits comfortably under ` +
        `45% high plus 20% mid. Low cloud is the one that blocks the sun at the horizon; mid and high cloud are ` +
        `what catch color once it is there. Any figure shows <em>n/a</em> when the forecast did not report it, ` +
        `which is not the same as 0%.</p>` +
        `<h3>Chance of precipitation</h3>` +
        `<p>Below the cloud figures, each card gives the forecast's precipitation probability for the same ` +
        `midpoint hour &mdash; a <strong>likelihood, not an amount</strong>, and not a share of the sky, which ` +
        `is why it sits outside the cloud block. It is reported here and left out of the ★ ideal-sky rule ` +
        `below, which reads the hour's condition code instead. The two can disagree: a window whose midpoint ` +
        `hour is dry can still carry a high chance of rain around it, and that is worth seeing before you pack ` +
        `a bag.</p>` +
        `<h3>WMO sky condition codes</h3>` +
        `<p>This table is here for the <strong>raw data output</strong>, not for the report: the cards above ` +
        `always print the label, while each window in the dataset also carries the numeric code it came from ` +
        `(<code>wmoCode</code>). Look a code up here to read the dataset without this page beside it.</p>` +
        `<div class="table-scroll"><table class="wmo-table">` +
        `<thead><tr><th>WMO code(s)</th><th>Label</th></tr></thead>` +
        `<tbody>${buildWmoTableRows()}</tbody></table></div>` +
        `<h3>Ideal-sky rule</h3>` +
        `<p>A window is highlighted as <strong>ideal sky</strong> when the forecast reports no rain, snow or ` +
        `fog at its midpoint hour <em>and</em> all four cloud figures sit inside these bands ` +
        `<em>at the same time</em> &mdash; every band inclusive at both ends:</p>${renderIdealSkyBandTable()}<p>High cloud is the money-maker &mdash; thin and icy, it catches light from below once the sun drops ` +
        `toward the horizon and turns pink, orange and red; too little and there is nothing to light up, too ` +
        `much and the light source itself is screened off. Mid cloud adds texture in moderation but greys ` +
        `everything out when solid. Low cloud is the enemy: it sits on the horizon line and blocks the ` +
        `low-angle light that defines golden hour. Total cover is a <strong>separate whole-sky reading</strong>, ` +
        `not the sum of the other three, and it rules out both the empty sky with nothing to catch color and ` +
        `the closed-in one. Because all four are required, a window missing any of them from the forecast is ` +
        `never marked ideal.</p>` +
        `<p>One caveat the data can't cover: the forecast gives one whole-sky figure per layer with no ` +
        `bearing, so a near-zero low reading is the best available stand-in for what actually matters, which ` +
        `is clear horizon <em>in the direction of the sun</em>. This is a presentation highlight on top of ` +
        `the reported condition and raw numbers, not a replacement for them.</p>` +
        `<p class="attribution">` +
        `<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo.com</a>` +
        `</p>` +
        `</footer>`
    );
}

/**
 * The full self-contained HTML report. Nothing here filters: every item passed in
 * appears in the output.
 */
export function renderReport(items: DatasetItem[], meta: ReportMeta): string {
    const grouped = groupByDate(items);
    const dates = [...grouped.keys()];

    const sections = [...grouped.entries()]
        .map(([date, dayItems]) => {
            const polar = dayItems.find((item): item is PolarItem => item.type === 'polar');
            if (polar) return renderPolarBanner(polar);
            const noWindows = dayItems.find((item): item is NoWindowsItem => item.type === 'noWindows');
            if (noWindows) return renderNoWindowsBanner(noWindows);
            return renderDaySection(date, dayItems.filter(isWindowItem));
        })
        .join('\n');

    return (
        `<!doctype html>\n` +
        `<html lang="en">\n` +
        `<head>\n` +
        `<meta charset="utf-8" />\n` +
        `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
        `<title>Golden Hour Scout — ${escapeHtml(meta.location.name)}</title>\n` +
        `<style>${REPORT_CSS}</style>\n` +
        `</head>\n` +
        `<body>\n` +
        `<div class="wrap">\n${renderHeader(
            meta.location,
            dates,
        )}\n<main>\n${sections}\n</main>\n${renderFooter()}\n</div>\n` +
        `</body>\n` +
        `</html>\n`
    );
}
