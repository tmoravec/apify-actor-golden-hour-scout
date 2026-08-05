import { describe, it, expect } from 'vitest';
import { wmoLabel, isIdealSky, WMO_LABEL_TABLE } from '../src/wmo.js';

describe('wmoLabel', () => {
  // The interesting contract is the GROUPING -- which raw codes collapse into
  // one human label -- not the individual table entries. Asserting entry by
  // entry would just retype `WMO_LABELS` in a second place, so this pins the
  // partition instead: every label maps to exactly this set of codes, and any
  // code added to, moved between, or dropped from a group fails here.
  const EXPECTED_GROUPS: Record<string, number[]> = {
    Clear: [0],
    'Mainly clear': [1],
    'Partly cloudy': [2],
    Overcast: [3],
    // 40/41/43/44/49 are legacy WMO fog variants Open-Meteo does not document;
    // they are carried as a defensive superset, and this is where that decision
    // is recorded.
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

  /** The four bands, as `[figure, min, max]` -- the shape the conjunction is tested against. */
  const BANDS = [
    ['cloudHigh', 30, 60],
    ['cloudMid', 0, 40],
    ['cloudLow', 0, 10],
    ['cloudTotal', 30, 70],
  ] as const;

  it('is true when every figure sits inside its band', () => {
    expect(isIdealSky(2, SWEET_SPOT)).toBe(true);
    expect(isIdealSky(1, { cloudHigh: 55, cloudMid: 0, cloudLow: 0, cloudTotal: 60 })).toBe(true);
  });

  // The published bands, pinned one figure at a time. Anything that moves a
  // band edge fails exactly the row it moved.
  it.each(BANDS)('holds %s to [%d, %d], inclusive at both ends', (key, min, max) => {
    expect(isIdealSky(2, { ...SWEET_SPOT, [key]: min })).toBe(true);
    expect(isIdealSky(2, { ...SWEET_SPOT, [key]: max })).toBe(true);
    expect(isIdealSky(2, { ...SWEET_SPOT, [key]: max + 1 })).toBe(false);
    // A 0-floor band can't go below its minimum, so only the upper edge moves there.
    if (min > 0) expect(isIdealSky(2, { ...SWEET_SPOT, [key]: min - 1 })).toBe(false);
  });

  // High cloud has a FLOOR, not just a ceiling: this is what replaced the old
  // rule's blanket exclusion of "Clear". A cloudless sky has nothing to catch
  // colour, and that is now judged on the number rather than on which side of
  // a WMO label it happens to fall.
  it('is false for a cloudless sky, which has nothing to catch colour', () => {
    expect(isIdealSky(0, { cloudHigh: 0, cloudMid: 0, cloudLow: 0, cloudTotal: 0 })).toBe(false);
  });

  it('is false for any precipitating, fogged, unknown or missing code, perfect cloud notwithstanding', () => {
    for (const code of [45, 48, 51, 61, 71, 80, 95, 99, 12345, null]) {
      expect(isIdealSky(code, SWEET_SPOT)).toBe(false);
    }
  });

  // The bands decide the positive case; the code only disqualifies. Overcast
  // (3) is allowed through rather than special-cased, since the 30-70% total
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
