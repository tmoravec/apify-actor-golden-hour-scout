import { describe, expect, it } from 'vitest';

import { buildStatusMessage } from '../src/output.js';
import { renderReport } from '../src/report/render.js';
import type { GeoLocation, HourlySample } from '../src/types.js';
import { isWindowItem } from '../src/types.js';
import { buildWindows } from '../src/windows.js';

/**
 * The one offline check on the composition itself -- windows -> report -> status
 * message -- which `main.ts`, being untested, cannot provide. No mocks and no
 * `Actor`: pure functions wired up exactly as `main.ts` wires them.
 */

const YOSEMITE_LOCATION: GeoLocation = {
    name: 'Yosemite Valley, California, United States',
    admin1: 'California',
    country: 'United States',
    latitude: 37.7456,
    longitude: -119.5936,
    timezone: 'America/Los_Angeles',
};

/** 7 x 24 hourly samples from local midnight (Yosemite, PDT = UTC-7 in August). */
function buildSamples(): HourlySample[] {
    const startUtcMs = Date.UTC(2026, 7, 1, 7, 0, 0); // 2026-08-01T00:00:00-07:00
    const samples: HourlySample[] = [];
    for (let i = 0; i < 7 * 24; i++) {
        samples.push({
            time: new Date(startUtcMs + i * 3600 * 1000),
            weatherCode: 1,
            cloudTotal: 48,
            cloudLow: 1,
            cloudMid: 5,
            cloudHigh: 45,
            precipProb: 0,
        });
    }
    return samples;
}

describe('pipeline: buildWindows -> renderReport -> buildStatusMessage', () => {
    it('produces 28 dataset items (7 days x 4 window types) for an ordinary week', () => {
        const items = buildWindows(buildSamples(), YOSEMITE_LOCATION);

        expect(items).toHaveLength(28);
        expect(items.every(isWindowItem)).toBe(true);
    });

    it('renders a self-contained report naming the location', () => {
        const items = buildWindows(buildSamples(), YOSEMITE_LOCATION);

        const html = renderReport(items, { location: YOSEMITE_LOCATION });

        expect(html).toContain('<!doctype html>');
        expect(html).toContain(YOSEMITE_LOCATION.name);
    });

    it('builds a status message naming an ideal-sky window actually present in the dataset', () => {
        const items = buildWindows(buildSamples(), YOSEMITE_LOCATION);
        const now = new Date('2026-07-25T00:00:00Z'); // before the whole 7-day run

        const message = buildStatusMessage(items, YOSEMITE_LOCATION, now);

        // The next-ideal-sky part must name a real item, not an invented window.
        const named = items
            .filter(isWindowItem)
            .find((item) => item.idealSky && message.includes(item.type) && message.includes(item.date));
        expect(named).toBeDefined();
    });
});
