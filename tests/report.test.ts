import { describe, it, expect, vi } from 'vitest';
import { renderReport } from '../src/report/render.js';
import { escapeHtml } from '../src/report/escape.js';
import { WMO_LABEL_TABLE, IDEAL_SKY_BANDS } from '../src/wmo.js';
import type { WindowItem, PolarItem, NoWindowsItem, DatasetItem, GeoLocation } from '../src/types.js';

const LOCATION: GeoLocation = {
  name: 'Yosemite Valley, California, United States',
  admin1: 'California',
  country: 'United States',
  latitude: 37.7456,
  longitude: -119.5936,
  timezone: 'America/Los_Angeles',
};

function windowItem(overrides: Partial<WindowItem> = {}): WindowItem {
  return {
    date: '2026-08-02',
    type: 'blueHourMorning',
    startLocal: '2026-08-02T05:00:00-07:00',
    endLocal: '2026-08-02T05:30:00-07:00',
    condition: 'Partly cloudy',
    wmoCode: 2,
    conditionSequence: ['Partly cloudy'],
    idealSky: false,
    conditions: { cloudTotal: 40, cloudLow: 10, cloudMid: 20, cloudHigh: 30, precipProb: 5 },
    sun: { sunrise: '2026-08-02T06:03:00-07:00', sunset: '2026-08-02T20:11:00-07:00', azimuthAtPeak: 68 },
    location: LOCATION,
    ...overrides,
  };
}

// A window that has already elapsed relative to the other two; the report draws
// it exactly like any other.
const pastWindow = windowItem({
  type: 'blueHourMorning',
  startLocal: '2026-08-02T05:00:00-07:00',
  endLocal: '2026-08-02T05:30:00-07:00',
  idealSky: false,
});

// A "future" window, marked ideal-sky, that also happens to be on the same day.
const futureIdealWindow = windowItem({
  type: 'goldenHourEvening',
  startLocal: '2026-08-02T20:11:00-07:00',
  endLocal: '2026-08-02T21:06:00-07:00',
  condition: 'Mainly clear',
  wmoCode: 1,
  conditionSequence: ['Mainly clear', 'Mainly clear'],
  idealSky: true,
  conditions: { cloudTotal: 15, cloudLow: 5, cloudMid: 8, cloudHigh: 12, precipProb: 0 },
});

// A second day, plain (non-ideal), used for date-range assertions.
const secondDayWindow = windowItem({
  date: '2026-08-03',
  type: 'goldenHourMorning',
  startLocal: '2026-08-03T06:03:00-07:00',
  endLocal: '2026-08-03T06:58:00-07:00',
  sun: { sunrise: '2026-08-03T06:04:00-07:00', sunset: '2026-08-03T20:10:00-07:00', azimuthAtPeak: 75 },
});

const polarItem: PolarItem = {
  date: '2026-08-05',
  type: 'polar',
  reason: 'polar-day',
  location: LOCATION,
};

const ALL_ITEMS: DatasetItem[] = [pastWindow, futureIdealWindow, secondDayWindow, polarItem];

function render(items: DatasetItem[] = ALL_ITEMS): string {
  return renderReport(items, { location: LOCATION });
}

/** Extracts the timeline `<rect>` for a given window type, attributes included. */
function bandFor(html: string, windowType: string): string {
  const match = new RegExp(`<rect[^>]*data-window-type="${windowType}"[^>]*>`).exec(html);
  expect(match).not.toBeNull();
  return match![0];
}

function attr(tag: string, name: string): number {
  const match = new RegExp(`${name}="([\\d.]+)"`).exec(tag);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

describe('renderReport', () => {
  it('produces a single self-contained document with no external links except the Open-Meteo attribution', () => {
    const html = render();
    expect(html).toContain('<!doctype html>');

    // Every src=/href= attribute value must be non-http(s), EXCEPT exactly one:
    // the required Open-Meteo attribution link.
    const externalRefs = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(externalRefs).toHaveLength(1);
    expect(externalRefs[0]).toContain('open-meteo.com');
  });

  it('shows the resolved location name and the 7-day date range prominently in the header', () => {
    const html = render();
    const headerMatch = /<header[^>]*>([\s\S]*?)<\/header>/.exec(html);
    expect(headerMatch).not.toBeNull();
    const header = headerMatch![1];
    expect(header).toContain('Yosemite Valley, California, United States');
    expect(header).toContain('2026-08-02');
    expect(header).toContain('2026-08-05');
  });

  it('renders one daylight band per day plus one timeline band per window, with an ideal-sky highlight class', () => {
    const html = render();

    // 2 days have windows (2026-08-02, 2026-08-03); the polar day (2026-08-05) is a banner, not a timeline row.
    const daylightBands = html.match(/class="[^"]*daylight-band[^"]*"/g) ?? [];
    expect(daylightBands).toHaveLength(2);

    const windowBands = html.match(/class="[^"]*window-band[^"]*"/g) ?? [];
    expect(windowBands).toHaveLength(3); // pastWindow + futureIdealWindow + secondDayWindow

    const idealBands = html.match(/class="[^"]*window-band[^"]*ideal-sky[^"]*"/g) ?? [];
    expect(idealBands).toHaveLength(1);
  });

  it('renders an elapsed window exactly like an upcoming one -- no dimming, and the output is wall-clock independent', () => {
    // The contract is that nothing in the report consults `now`, so the same
    // items render to the same bytes whenever the run happens. Asserting the
    // whole document is identical -- rather than the absence of one class name
    // -- catches a dimming/hiding regression whatever the new marker is called.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-01T00:00:00Z')); // before every window
      const early = render();
      vi.setSystemTime(new Date('2027-01-01T00:00:00Z')); // months after all of them
      const late = render();

      expect(late).toBe(early);

      // Both windows are still present in the document (never dropped).
      expect(early).toContain('data-window-type="blueHourMorning"');
      expect(early).toContain('data-window-type="goldenHourEvening"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('states each window\'s three cloud layers as plain figures, with no stacked bar', () => {
    const html = render([windowItem()]); // low 10 / mid 20 / high 30

    const cloudMatch = /<div class="wc-cloud">([\s\S]*?)<\/div>/.exec(html);
    expect(cloudMatch).not.toBeNull();
    const cloud = cloudMatch![1];

    // High-to-low, matching how the layers sit in the sky.
    expect([...cloud.matchAll(/<li>(high|mid|low)<b>([^<]*)<\/b><\/li>/g)].map((m) => [m[1], m[2]])).toEqual([
      ['high', '30%'],
      ['mid', '20%'],
      ['low', '10%'],
    ]);
  });

  it('prints the figures unchanged when the layers total more than 100%, with no rescale note', () => {
    // Independent layers (Open-Meteo reports low/mid/high separately), so a deep
    // thunderstorm cell easily sums past 100. The old bar had to switch scales
    // here and disclose it in a note; the numbers just read as themselves.
    const stormy = windowItem({
      conditions: { cloudTotal: 100, cloudLow: 100, cloudMid: 100, cloudHigh: 100, precipProb: 90 },
    });
    const html = render([stormy]);

    for (const layer of ['high', 'mid', 'low']) {
      expect(html).toContain(`<li>${layer}<b>100%</b></li>`);
    }
  });

  it('distinguishes an unreported cloud layer from a measured 0%', () => {
    const partial = windowItem({
      conditions: { cloudTotal: 10, cloudLow: 0, cloudMid: 10, cloudHigh: null, precipProb: 0 },
    });
    const html = render([partial]);

    expect(html).toContain('<li>high<b>n/a</b></li>');
    expect(html).toContain('<li>low<b>0%</b></li>');
  });

  // Total is on the card because the ideal-sky rule tests it: a card that
  // showed only the three layers could not explain its own presence or absence
  // of a ★. It is ruled off rather than listed as a fourth peer, since it is a
  // separate whole-sky reading and emphatically not the column's sum.
  it("states the window's total cloud cover, set apart from the three layers", () => {
    const html = render([windowItem()]); // total 40, layers 30/20/10 -- deliberately not their sum

    const cloudMatch = /<div class="wc-cloud">([\s\S]*?)<\/div>/.exec(html);
    const cloud = cloudMatch![1];

    expect(cloud).toContain('<li class="cloud-total">total<b>40%</b></li>');
    // Last, and the only row carrying the separating class.
    expect(cloud.indexOf('cloud-total')).toBeGreaterThan(cloud.indexOf('>low<'));
    expect(cloud.match(/cloud-total/g)).toHaveLength(1);
  });

  it('shows n/a for an unreported total, which is not a measured 0%', () => {
    const html = render([
      windowItem({ conditions: { cloudTotal: null, cloudLow: 0, cloudMid: 10, cloudHigh: 30, precipProb: 0 } }),
    ]);
    expect(html).toContain('<li class="cloud-total">total<b>n/a</b></li>');
  });

  it('draws a window that runs past local midnight at its true length, clipped at the day edge -- not as a 2-minute nub', () => {
    // Anchorage (61.22 N) 2026-06-21, straight from suncalc: the sunset-golden
    // window starts at 21:34 and ends at 00:46 the NEXT local date. Reading
    // both edges as bare "HH:MM" gives 46 - 1294 = -1248, which the old
    // `Math.max(width, 2)` clamp collapsed into a 2-unit speck at x=1294 --
    // a ~3-hour window rendered as invisible.
    const crossMidnight = windowItem({
      date: '2026-06-21',
      type: 'goldenHourEvening',
      startLocal: '2026-06-21T21:34:55-08:00',
      endLocal: '2026-06-22T00:46:41-08:00',
    });
    const html = render([crossMidnight]);
    const band = bandFor(html, 'goldenHourEvening');

    const x = attr(band, 'x');
    const width = attr(band, 'width');
    expect(x).toBe(21 * 60 + 34);

    // The visible part is everything from the start to local midnight...
    expect(width).toBe(1440 - x);
    // ...which is the real regression assertion: far more than the old nub.
    expect(width).toBeGreaterThan(2);
    // ...and it stops exactly at the day's right edge, never overflowing it.
    expect(x + width).toBe(1440);

    // The clipped continuation is disclosed, not silently dropped.
    expect(band).toMatch(/class="[^"]*runs-past-midnight[^"]*"/);
    expect(html).toContain('runs past midnight into 2026-06-22');
  });

  it('keeps an ordinary same-day window at its exact span, with no cross-midnight marker', () => {
    // The companion to the test above: the fix must not perturb the common
    // case, and must not flag it as crossing midnight.
    const html = render([futureIdealWindow]); // 20:11 -> 21:06 on 2026-08-02
    const band = bandFor(html, 'goldenHourEvening');

    expect(attr(band, 'x')).toBe(20 * 60 + 11);
    expect(attr(band, 'width')).toBe(55);
    expect(band).not.toMatch(/runs-past-midnight/);
    expect(html).not.toContain('runs past midnight');
  });

  it('draws the daylight band correctly when sunset itself falls after local midnight', () => {
    // Reykjavik-style geometry: sunrise 02:55, sunset 00:04 the next date.
    // The daylight band had the same negative-width bug as the window bands.
    const subPolar = windowItem({
      date: '2026-06-21',
      type: 'goldenHourMorning',
      startLocal: '2026-06-21T02:55:00+00:00',
      endLocal: '2026-06-21T05:39:00+00:00',
      sun: { sunrise: '2026-06-21T02:55:00+00:00', sunset: '2026-06-22T00:04:00+00:00', azimuthAtPeak: 60 },
    });
    const html = render([subPolar]);

    const daylightMatch = /<rect class="daylight-band[^"]*"[^>]*>/.exec(html);
    expect(daylightMatch).not.toBeNull();
    const sunriseMin = 2 * 60 + 55;
    expect(attr(daylightMatch![0], 'x')).toBe(sunriseMin);
    expect(attr(daylightMatch![0], 'width')).toBe(1440 - sunriseMin); // ~21h of daylight, not a 1-unit sliver
  });

  it('renders an explanatory banner -- not an empty day, not a polar banner -- for a non-polar day with zero windows', () => {
    const noWindows: NoWindowsItem = {
      date: '2026-06-21',
      type: 'noWindows',
      reason: 'no-boundary-crossings',
      location: LOCATION,
    };
    const html = render([noWindows]);

    const bannerMatch = /<div class="[^"]*no-windows-banner[^"]*">([\s\S]*?)<\/div>/.exec(html);
    expect(bannerMatch).not.toBeNull();
    const banner = bannerMatch![1];

    // The day is represented rather than silently absent...
    expect(banner).toContain('2026-06-21');
    expect(banner).toMatch(/no photography windows today/i);
    // ...but the banner must NOT claim a polar day/night, which would be
    // factually wrong: the sun does rise and set on this date.
    expect(banner).not.toMatch(/polar[- ](day|night)/i);
    expect(banner).toMatch(/rises and sets/i);
    // No timeline row for a day with nothing to plot.
    expect(html).not.toContain('data-window-type=');
  });

  it('stays well under the 1 MB report-size budget', () => {
    // A hard ceiling the plan commits to: the report is a single self-contained
    // key-value-store record, so unbounded inline CSS/SVG growth is the thing
    // to catch. Asserted on a full 7-day, 28-window run, not the small default
    // fixture, so the guard reflects a realistic worst case.
    const fullWeek: DatasetItem[] = [];
    for (let day = 2; day <= 8; day++) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      for (const type of ['blueHourMorning', 'goldenHourMorning', 'goldenHourEvening', 'blueHourEvening'] as const) {
        fullWeek.push(
          windowItem({
            date,
            type,
            startLocal: `${date}T20:11:00-07:00`,
            endLocal: `${date}T21:06:00-07:00`,
            conditionSequence: ['Partly cloudy', 'Mainly clear'],
          }),
        );
      }
    }

    const html = renderReport(fullWeek, { location: LOCATION });
    expect(fullWeek).toHaveLength(28);
    expect(Buffer.byteLength(html, 'utf-8')).toBeLessThan(1024 * 1024);
  });

  it('renders a polar banner instead of a timeline row for a polar day/night', () => {
    const html = render();
    expect(html).toContain('polar-banner');
    expect(html).toMatch(/polar[- ]day/i);
    // The polar date's own banner section (not just the header date range) must contain the date.
    const bannerIndex = html.lastIndexOf('polar-banner');
    const polarSection = html.slice(bannerIndex, bannerIndex + 500);
    expect(polarSection).toContain('2026-08-05');
  });

  it('includes the WMO code table (reused from wmo.ts), the ideal-sky rule, and the Open-Meteo attribution link in the footer', () => {
    const html = render();
    const footerMatch = /<footer[^>]*>([\s\S]*?)<\/footer>/.exec(html);
    expect(footerMatch).not.toBeNull();
    const footer = footerMatch![1];

    // Every label from the shared WMO table must appear in the footer (reused, not hand-duplicated).
    const uniqueLabels = new Set(Object.values(WMO_LABEL_TABLE));
    for (const label of uniqueLabels) {
      expect(footer).toContain(label);
    }

    expect(footer.toLowerCase()).toContain('ideal sky');
    // The stated rule must be the implemented rule: every band is read out of
    // wmo.ts, so a page that omits one or states it wrong fails here.
    for (const { min, max } of Object.values(IDEAL_SKY_BANDS)) {
      expect(footer).toContain(`<td>${min}&ndash;${max}%</td>`);
    }
    // The conjunction is the rule's whole point and the easiest thing for the
    // prose to soften into a list of independent preferences.
    expect(footer).toContain('at the same time');
    expect(footer).toContain('Weather data by Open-Meteo.com');
    expect(footer).toMatch(/href="https:\/\/open-meteo\.com[^"]*"/);
  });

  it('escapes markup in the location name everywhere it is interpolated', () => {
    // The name reaches the report straight from the geocoding API's response
    // (and, on the coordinates path, from parsed user input), so it is not
    // trusted markup. It lands in both <title> and <h1>; both must be escaped.
    const hostile: GeoLocation = { ...LOCATION, name: `<script>alert("xss")</script>` };
    const html = renderReport([windowItem({ location: hostile })], { location: hostile });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    // Two interpolation sites, both escaped -- <title> and the header <h1>.
    expect([...html.matchAll(/&lt;script&gt;/g)]).toHaveLength(2);
  });
});

describe('escapeHtml', () => {
  it('escapes all five entities that can break out of markup or an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('escapes the ampersand first, so entities are not double-escaped', () => {
    // Naive ordering (& replaced last) would turn "<" into "&amp;lt;".
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});
