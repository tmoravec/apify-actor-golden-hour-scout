import { describe, expect, it } from 'vitest';

import { BAND_COLORS, bandColor, renderHourAxisHtml, SKY_TIER_LABELS, UNKNOWN_BAND_COLOR } from '../src/report/svg.js';

// `report.test.ts` reaches this module only through `renderReport` and asserts
// geometry but never colour or axis output, leaving two rules unguarded: "hue is
// the window type, lightness is the sky", and "an unreported sky must not look
// like a clear one". Pinned here against the exported building blocks.
describe('report/svg.ts bandColor()', () => {
    it('hue carries the window type: a blue-hour band never matches a golden-hour band under the same condition', () => {
        expect(bandColor('goldenHourEvening', 'Rain')).not.toBe(bandColor('blueHourEvening', 'Rain'));
        expect(bandColor('goldenHourMorning', 'Clear')).not.toBe(bandColor('blueHourMorning', 'Clear'));
    });

    it('lightness carries the sky: the same window type reads differently across sky tiers', () => {
        expect(bandColor('goldenHourEvening', 'Clear')).not.toBe(bandColor('goldenHourEvening', 'Overcast'));
        expect(bandColor('blueHourMorning', 'Clear')).not.toBe(bandColor('blueHourMorning', 'Rain'));
    });

    // An unreported sky ("n/a"/"Unknown") is not a *clear* sky and must not look
    // like one -- the same n/a-is-not-0% distinction `report.test.ts` pins for the
    // numbers, here for the colour.
    it('an unreported condition gets the flat neutral, not a position on either ramp', () => {
        expect(bandColor('goldenHourEvening', 'n/a')).toBe(UNKNOWN_BAND_COLOR);
        expect(bandColor('goldenHourEvening', 'Unknown')).toBe(UNKNOWN_BAND_COLOR);
        expect(bandColor('blueHourMorning', 'n/a')).toBe(UNKNOWN_BAND_COLOR);

        expect(BAND_COLORS.golden).not.toContain(UNKNOWN_BAND_COLOR);
        expect(BAND_COLORS.blue).not.toContain(UNKNOWN_BAND_COLOR);
    });

    it('the sky-tier ramp and its footer labels stay the same length', () => {
        expect(SKY_TIER_LABELS).toHaveLength(BAND_COLORS.golden.length);
        expect(SKY_TIER_LABELS).toHaveLength(BAND_COLORS.blue.length);
    });
});

describe('report/svg.ts renderHourAxisHtml()', () => {
    it('emits 9 marks at 3-hourly steps, primary/secondary density and start/end edges split as documented', () => {
        const html = renderHourAxisHtml();
        const marks = [...html.matchAll(/<span class="([^"]+)"[^>]*>(\d{2})<\/span>/g)].map((m) => ({
            classes: m[1],
            label: m[2],
        }));

        // A mark every 3 hours, primary every 6 and `.secondary` between, with hour
        // 0 and hour 24 pinned to the panel edge rather than centred on their tick.
        expect(marks).toEqual([
            { classes: 'hour-mark start', label: '00' },
            { classes: 'hour-mark secondary', label: '03' },
            { classes: 'hour-mark', label: '06' },
            { classes: 'hour-mark secondary', label: '09' },
            { classes: 'hour-mark', label: '12' },
            { classes: 'hour-mark secondary', label: '15' },
            { classes: 'hour-mark', label: '18' },
            { classes: 'hour-mark secondary', label: '21' },
            { classes: 'hour-mark end', label: '24' },
        ]);
    });
});
