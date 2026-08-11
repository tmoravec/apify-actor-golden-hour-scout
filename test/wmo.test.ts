import { describe, expect, it } from 'vitest';

import { isIdealSky, WMO_LABEL_TABLE, wmoLabel } from '../src/wmo.js';

describe('wmoLabel', () => {
    // The contract is the GROUPING -- which raw codes collapse into one label --
    // not the individual entries, which asserted one by one would just retype
    // `WMO_LABELS` elsewhere. Pinning the partition catches any code added to,
    // moved between, or dropped from a group.
    const EXPECTED_GROUPS: Record<string, number[]> = {
        Clear: [0],
        'Mainly clear': [1],
        'Partly cloudy': [2],
        Overcast: [3],
        // 40/41/43/44/49 are legacy WMO fog variants Open-Meteo does not document,
        // carried as a defensive superset.
        Fog: [40, 41, 43, 44, 45, 48, 49],
        Drizzle: [51, 53, 55, 56, 57],
        Rain: [61, 63, 65, 66, 67, 80, 81, 82],
        Snow: [71, 73, 75, 77, 85, 86],
        Thunderstorm: [95, 96, 99],
    };

    it('groups exactly these codes under each label, and defines no others', () => {
        const actualGroups: Record<string, number[]> = {};
        for (const [codeStr, label] of Object.entries(WMO_LABEL_TABLE)) {
            (actualGroups[label] ??= []).push(Number(codeStr));
        }
        for (const codes of Object.values(actualGroups)) codes.sort((a, b) => a - b);

        expect(actualGroups).toEqual(EXPECTED_GROUPS);
    });

    it('falls back to "Unknown" for an out-of-table code, keeping the raw code', () => {
        expect(wmoLabel(12345)).toEqual({ label: 'Unknown', wmoCode: 12345 });
    });

    it('maps a null weather code to "n/a" with wmoCode null', () => {
        expect(wmoLabel(null)).toEqual({ label: 'n/a', wmoCode: null });
    });
});

describe('isIdealSky', () => {
    /** Dead-centre of every band: each case below varies ONE axis off this. */
    const SWEET_SPOT = { cloudHigh: 45, cloudMid: 15, cloudLow: 3, cloudTotal: 50 };

    /**
     * The four bands as `[figure, min, max, belowMinIsRejected]`. That last flag
     * is in the table rather than branched on in the body, so every row states
     * what it checks: a 0-floor band has no below-minimum case to assert.
     */
    const BANDS = [
        ['cloudHigh', 30, 60, true],
        ['cloudMid', 0, 40, false],
        ['cloudLow', 0, 10, false],
        ['cloudTotal', 30, 70, true],
    ] as const;

    it('is true when every figure sits inside its band', () => {
        expect(isIdealSky(2, SWEET_SPOT)).toBe(true);
        expect(isIdealSky(1, { cloudHigh: 55, cloudMid: 0, cloudLow: 0, cloudTotal: 60 })).toBe(true);
    });

    // One figure at a time, so moving a band edge fails exactly its own row.
    it.each(BANDS)('holds %s to [%d, %d], inclusive at both ends', (key, min, max, belowMinIsRejected) => {
        expect(isIdealSky(2, { ...SWEET_SPOT, [key]: min })).toBe(true);
        expect(isIdealSky(2, { ...SWEET_SPOT, [key]: max })).toBe(true);
        expect(isIdealSky(2, { ...SWEET_SPOT, [key]: max + 1 })).toBe(false);
        if (belowMinIsRejected) expect(isIdealSky(2, { ...SWEET_SPOT, [key]: min - 1 })).toBe(false);
    });

    it('is false for any precipitating, fogged, unknown or missing code, perfect cloud notwithstanding', () => {
        for (const code of [45, 48, 51, 61, 71, 80, 95, 99, 12345, null]) {
            expect(isIdealSky(code, SWEET_SPOT)).toBe(false);
        }
    });

    // The bands decide the positive case and the code only disqualifies, so
    // Overcast (3) passes through rather than being special-cased -- the total-cover
    // band excludes a genuinely overcast sky on the numbers.
    it('admits any dry, unobscured code (0-3) that meets the bands', () => {
        for (const code of [0, 1, 2, 3]) {
            expect(isIdealSky(code, SWEET_SPOT)).toBe(true);
        }
    });

    it.each(BANDS.map(([key]) => key))(
        'is false when %s is null (an unreported figure is unknown, never 0%%)',
        (key) => {
            expect(isIdealSky(2, { ...SWEET_SPOT, [key]: null })).toBe(false);
        },
    );
});
