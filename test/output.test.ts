import { describe, expect, it } from 'vitest';

import { buildNextIdealSky, buildStatusMessage } from '../src/output.js';
import type { DatasetItem, GeoLocation, PolarItem, WindowItem } from '../src/types.js';

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
        date: '2026-08-01',
        type: 'blueHourMorning',
        startLocal: '2026-08-01T05:00:00-07:00',
        endLocal: '2026-08-01T05:30:00-07:00',
        condition: 'Mainly clear',
        wmoCode: 1,
        conditionSequence: ['Mainly clear'],
        idealSky: true,
        conditions: { cloudTotal: 48, cloudLow: 1, cloudMid: 5, cloudHigh: 45, precipProb: 0 },
        sun: { sunrise: '2026-08-01T06:00:00-07:00', sunset: '2026-08-01T20:00:00-07:00', azimuthAtPeak: 90 },
        location: LOCATION,
        ...overrides,
    };
}

const POLAR_ITEM: PolarItem = { date: '2026-06-21', type: 'polar', reason: 'polar-day', location: LOCATION };

describe('output.ts buildNextIdealSky()', () => {
    it('resolves a future ideal window to that dataset item', () => {
        const now = new Date('2026-08-01T00:00:00-07:00');
        const item = windowItem({ endLocal: '2026-08-01T05:30:00-07:00' });

        const { nextIdealSky, nextIdealSkyReason } = buildNextIdealSky([item], now);

        expect(nextIdealSky).toBe(item);
        expect(nextIdealSkyReason).toBeUndefined();
    });

    it('a window ending exactly at `now` is already past (strict boundary)', () => {
        const endLocal = '2026-08-01T05:30:00-07:00';
        const now = new Date(endLocal);
        const item = windowItem({ endLocal });

        const { nextIdealSky, nextIdealSkyReason } = buildNextIdealSky([item], now);

        expect(nextIdealSky).toBeNull();
        expect(nextIdealSkyReason).toMatch(/passed/i);
    });

    it('non-ideal windows and non-window (polar) items are skipped', () => {
        const now = new Date('2026-08-01T00:00:00-07:00');
        const notIdeal = windowItem({ idealSky: false, endLocal: '2026-08-01T06:00:00-07:00' });

        const { nextIdealSky, nextIdealSkyReason } = buildNextIdealSky([notIdeal, POLAR_ITEM], now);

        expect(nextIdealSky).toBeNull();
        expect(nextIdealSkyReason).toMatch(/no ideal-sky/i);
    });

    it('unsorted input still resolves to the chronologically first future window', () => {
        const now = new Date('2026-08-01T00:00:00-07:00');
        const later = windowItem({
            type: 'goldenHourEvening',
            startLocal: '2026-08-03T19:00:00-07:00',
            endLocal: '2026-08-03T19:30:00-07:00',
        });
        const earlier = windowItem({
            type: 'blueHourMorning',
            startLocal: '2026-08-01T05:00:00-07:00',
            endLocal: '2026-08-01T05:30:00-07:00',
        });

        // Deliberately unsorted (later window first).
        const { nextIdealSky } = buildNextIdealSky([later, earlier], now);

        expect(nextIdealSky).toBe(earlier);
    });
});

describe('output.ts buildStatusMessage()', () => {
    it('mentions the location name and the window count', () => {
        const now = new Date('2026-08-01T00:00:00-07:00');
        const items: DatasetItem[] = [windowItem(), windowItem({ type: 'goldenHourMorning' }), POLAR_ITEM];

        const message = buildStatusMessage(items, LOCATION, now);

        expect(message).toContain(LOCATION.name);
        // Two WindowItems; the PolarItem is not one. Pins the plural "windows" -- the
        // singular is pinned in the long-name test below.
        expect(message).toContain('2 photography windows');
    });

    it('names the next ideal-sky window when one exists', () => {
        const now = new Date('2026-08-01T00:00:00-07:00');
        const item = windowItem({ endLocal: '2026-08-01T05:30:00-07:00' });

        const message = buildStatusMessage([item], LOCATION, now);

        expect(message).toContain(item.type);
    });

    it('carries the reason instead of a dangling "Next ideal sky:" when none is found', () => {
        const now = new Date('2026-08-02T00:00:00-07:00');

        const message = buildStatusMessage([], LOCATION, now);

        expect(message).not.toMatch(/next ideal sky:\s*$/i);
        expect(message.toLowerCase()).toContain('no ideal-sky');
    });

    // A length assertion alone would be satisfied by a message that is all name,
    // with the summary it exists to carry cut off the end.
    it('keeps the window count and the ideal-sky part behind a very long location name', () => {
        const now = new Date('2026-08-01T00:00:00-07:00');
        const longLocation: GeoLocation = { ...LOCATION, name: 'X'.repeat(2000) };
        const item = windowItem({ endLocal: '2026-08-01T05:30:00-07:00' });

        const message = buildStatusMessage([item], longLocation, now);

        expect(message.length).toBeLessThan(600);
        expect(message).toContain('1 photography window');
        expect(message).toContain(item.type);
    });
});
