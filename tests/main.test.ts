import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Actor } from 'apify';
import { geocode } from '../src/geocode.js';
import { fetchHourlyWeather } from '../src/weather.js';
import { fetchJsonWithRetry } from '../src/http.js';
import { run } from '../src/main.js';
import { isWindowItem } from '../src/types.js';
import type { GeoLocation, HourlySample, DatasetItem, WindowItem } from '../src/types.js';

// `apify`, `geocode.ts`, `weather.ts`, and `http.ts` are stubbed (module
// boundaries + the lightweight `Actor` platform surface); `windows.ts` and
// `report/render.ts` are the real, pure implementations -- this test wires
// them together for one integration-style pass.
//
// `main.ts` calls `Actor.main(run)` unconditionally at the top level (the
// documented SDK pattern), so importing it for its `run` export DOES invoke
// `Actor.main` once, at import time. That is exactly what the stub below is
// for: it records the call and does nothing, so nothing runs until a test
// calls the exported `run()` itself with its own mocks in place.
vi.mock('apify', () => ({
  Actor: {
    main: vi.fn(),
    getInput: vi.fn(),
    pushData: vi.fn(),
    setValue: vi.fn(),
  },
}));

vi.mock('../src/geocode.js', () => ({
  geocode: vi.fn(),
}));

vi.mock('../src/weather.js', () => ({
  fetchHourlyWeather: vi.fn(),
}));

vi.mock('../src/http.js', () => ({
  fetchJsonWithRetry: vi.fn(),
}));

const mockedActor = vi.mocked(Actor, { deep: true });
const mockedGeocode = vi.mocked(geocode);
const mockedFetchHourlyWeather = vi.mocked(fetchHourlyWeather);
const mockedFetchJsonWithRetry = vi.mocked(fetchJsonWithRetry);

// Snapshot of `Actor.main`'s calls as of importing `main.ts`, captured here at
// collection time -- i.e. before `beforeEach`'s `vi.clearAllMocks()` erases the
// record. Asserted on below: loading the module must hand `run` to
// `Actor.main`, since that unconditional top-level call is the only thing that
// starts the Actor in production.
const ACTOR_MAIN_IMPORT_CALLS = mockedActor.main.mock.calls.slice();

const YOSEMITE_LOCATION: GeoLocation = {
  name: 'Yosemite Valley, California, United States',
  admin1: 'California',
  country: 'United States',
  latitude: 37.7456,
  longitude: -119.5936,
  timezone: 'America/Los_Angeles',
};

/** 7 x 24 synthetic hourly samples starting at true local midnight (Yosemite, PDT = UTC-7 in August). */
function buildSamples(days: number, hourFn: (globalHourIndex: number) => Partial<HourlySample>): HourlySample[] {
  const startUtcMs = Date.UTC(2026, 7, 1, 7, 0, 0); // 2026-08-01T00:00:00-07:00
  const samples: HourlySample[] = [];
  for (let i = 0; i < days * 24; i++) {
    samples.push({
      time: new Date(startUtcMs + i * 3600 * 1000),
      weatherCode: 1,
      cloudTotal: 48,
      cloudLow: 1,
      cloudMid: 5,
      cloudHigh: 45,
      precipProb: 0,
      ...hourFn(i),
    });
  }
  return samples;
}

/** All hours "Mainly clear" with 45/5/1 high/mid/low cloud -> every window across all 7 days is ideal-sky. */
const ALL_IDEAL_SAMPLES = buildSamples(7, () => ({}));

/** All hours "Overcast" -> zero ideal-sky windows anywhere in the 7 days. */
const NO_IDEAL_SAMPLES = buildSamples(7, () => ({ weatherCode: 3, cloudLow: 80 }));

/** `fetchHourlyWeather`'s result shape: samples + the response's own resolved IANA zone. */
function forecast(samples: HourlySample[], timezone: string | null = 'America/Los_Angeles') {
  return { samples, timezone };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
  delete process.env.APIFY_API_BASE_URL;

  // Sensible defaults; individual tests override as needed.
  mockedActor.getInput.mockResolvedValue({ location: 'Yosemite Valley, California' });
  mockedGeocode.mockResolvedValue(YOSEMITE_LOCATION);
  mockedFetchHourlyWeather.mockResolvedValue(forecast(ALL_IDEAL_SAMPLES));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
});

function findSetValueCall(key: string): unknown[] | undefined {
  return mockedActor.setValue.mock.calls.find((call) => call[0] === key);
}

describe('main.ts module load', () => {
  it('hands `run` to Actor.main unconditionally at import time (the only thing that starts the Actor in production)', () => {
    expect(ACTOR_MAIN_IMPORT_CALLS).toHaveLength(1);
    expect(ACTOR_MAIN_IMPORT_CALLS[0][0]).toBe(run);
  });
});

describe('main.ts run()', () => {
  it('geocodes the default/location input path (no coordinates set)', async () => {
    await run();

    expect(mockedGeocode).toHaveBeenCalledTimes(1);
    expect(mockedGeocode).toHaveBeenCalledWith('Yosemite Valley, California');
    expect(mockedFetchHourlyWeather).toHaveBeenCalledWith(YOSEMITE_LOCATION.latitude, YOSEMITE_LOCATION.longitude);
  });

  // The input-routing branches in `resolveTarget`. Each is one line, and each
  // is the kind of line a refactor drops silently: the private helper is only
  // reachable through `run()`, and the rest of the suite pins `getInput` to a
  // single well-formed value that never exercises them.
  it.each([
    ['an empty string', { location: '' }],
    ['whitespace only', { location: '   ' }],
    ['an absent location field', {}],
  ])('falls back to the default location when `location` is %s', async (_label, input) => {
    mockedActor.getInput.mockResolvedValue(input);

    await run();

    expect(mockedGeocode).toHaveBeenCalledTimes(1);
    expect(mockedGeocode).toHaveBeenCalledWith('Yosemite Valley, California');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats a %s getInput result as empty input and geocodes the default location', async (_label, input) => {
    // `Actor.getInput()` returns null for a run started with no input at all;
    // `main.ts`'s `?? {}` is what keeps that from throwing on property access.
    mockedActor.getInput.mockResolvedValue(input);

    await run();

    expect(mockedGeocode).toHaveBeenCalledWith('Yosemite Valley, California');
    expect(mockedActor.pushData).toHaveBeenCalledTimes(1);
  });

  it('lets `coordinates` win over a `location` set at the same time (the documented precedence)', async () => {
    mockedActor.getInput.mockResolvedValue({ location: 'Reykjavik', coordinates: '37.7456, -119.5936' });

    await run();

    expect(mockedGeocode).not.toHaveBeenCalled();
    expect(mockedFetchHourlyWeather).toHaveBeenCalledWith(37.7456, -119.5936);
    // Not "Reykjavik": the coordinates path has no place record to name, so the
    // formatted pair stands in and the ignored `location` leaves no trace.
    const output = findSetValueCall('OUTPUT')![1] as Record<string, unknown>;
    expect((output.location as GeoLocation).name).toBe('37.7456, -119.5936');
  });

  it('propagates a geocode failure to the caller instead of swallowing it, pushing nothing', async () => {
    // `run()` has no try/catch around `resolveTarget`; the rejection is meant to
    // reach `Actor.main`, which fails the run. A future `catch` that logged and
    // continued would push a dataset for the wrong (or no) location.
    mockedGeocode.mockRejectedValue(
      new Error('No geocoding results found for "xyzzyqwerty". Try a more specific place name, or pass `coordinates` instead.'),
    );

    await expect(run()).rejects.toThrow(/coordinates/i);
    expect(mockedFetchHourlyWeather).not.toHaveBeenCalled();
    expect(mockedActor.pushData).not.toHaveBeenCalled();
    expect(mockedActor.setValue).not.toHaveBeenCalled();
  });

  it('skips geocoding entirely when `coordinates` input is set, taking the timezone from the one forecast response', async () => {
    mockedActor.getInput.mockResolvedValue({ coordinates: '37.7456, -119.5936' });
    mockedFetchHourlyWeather.mockResolvedValue(forecast(ALL_IDEAL_SAMPLES, 'America/Los_Angeles'));

    await run();

    expect(mockedGeocode).not.toHaveBeenCalled();
    expect(mockedFetchHourlyWeather).toHaveBeenCalledTimes(1);
    expect(mockedFetchHourlyWeather).toHaveBeenCalledWith(37.7456, -119.5936);
    // No timezone-only side request: the forecast call already asks for
    // `timezone=auto` and reports back what it resolved, so the coordinates
    // path costs exactly one HTTP round-trip, not two.
    expect(mockedFetchJsonWithRetry).not.toHaveBeenCalled();

    const output = findSetValueCall('OUTPUT')![1] as Record<string, unknown>;
    expect(output.location).toEqual({
      name: '37.7456, -119.5936',
      latitude: 37.7456,
      longitude: -119.5936,
      timezone: 'America/Los_Angeles',
    });
  });

  it('fails with an actionable error when the coordinates path gets no timezone back from the forecast response', async () => {
    mockedActor.getInput.mockResolvedValue({ coordinates: '37.7456, -119.5936' });
    mockedFetchHourlyWeather.mockResolvedValue(forecast(ALL_IDEAL_SAMPLES, null));

    await expect(run()).rejects.toThrow(/timezone/i);
    expect(mockedActor.pushData).not.toHaveBeenCalled();
  });

  it("carries the full geocoded location to OUTPUT, preferring its timezone over the forecast's own", async () => {
    mockedFetchHourlyWeather.mockResolvedValue(forecast(ALL_IDEAL_SAMPLES, 'Etc/UTC'));

    await run();

    const output = findSetValueCall('OUTPUT')![1] as Record<string, unknown>;
    // Whole-object equality: name/admin1/country reach OUTPUT untouched, and
    // the zone is the geocoder's America/Los_Angeles, not the response's Etc/UTC.
    expect(output.location).toEqual(YOSEMITE_LOCATION);
  });

  it('fails fast on unparseable coordinates, naming all four accepted formats', async () => {
    mockedActor.getInput.mockResolvedValue({ coordinates: 'not a coordinate' });

    await expect(run()).rejects.toThrow(/decimal degrees/i);
    expect(mockedGeocode).not.toHaveBeenCalled();
  });

  it('pushes ALL windows to the dataset -- including already-passed ones -- never filtering by `now`', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T12:00:00-07:00')); // well into the 7-day run: earlier days' windows are past

    await run();

    expect(mockedActor.pushData).toHaveBeenCalledTimes(1);
    const pushed = mockedActor.pushData.mock.calls[0][0] as unknown[];
    expect(pushed).toHaveLength(28); // 7 days x 4 window types, none filtered
  });

  it("sets the report under key 'report.html' with content-type text/html", async () => {
    await run();

    const reportCall = findSetValueCall('report.html');
    expect(reportCall).toBeDefined();
    expect(typeof reportCall![1]).toBe('string');
    expect(reportCall![1] as string).toContain('<!doctype html>');
    expect(reportCall![2]).toEqual({ contentType: 'text/html' });
  });

  it('builds reportUrl from APIFY_DEFAULT_KEY_VALUE_STORE_ID + APIFY_API_BASE_URL on a platform run', async () => {
    process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID = 'store123';
    process.env.APIFY_API_BASE_URL = 'https://api.example-apify.test';

    await run();

    const outputCall = findSetValueCall('OUTPUT');
    const output = outputCall![1] as Record<string, unknown>;
    expect(output.reportUrl).toBe('https://api.example-apify.test/v2/key-value-stores/store123/records/report.html');
    expect(output.reportUrlReason).toBeUndefined();
  });

  it('falls back to reportUrl: null + reportUrlReason on a local run (no APIFY_DEFAULT_KEY_VALUE_STORE_ID)', async () => {
    await run();

    const outputCall = findSetValueCall('OUTPUT');
    const output = outputCall![1] as Record<string, unknown>;
    expect(output.reportUrl).toBeNull();
    expect(typeof output.reportUrlReason).toBe('string');
    expect((output.reportUrlReason as string).length).toBeGreaterThan(0);
  });

  it('nextIdealSky: now before an ideal-sky window -> the summary subset of the first future one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z')); // before the whole 7-day dataset

    await run();

    const outputCall = findSetValueCall('OUTPUT');
    const output = outputCall![1] as Record<string, unknown>;
    expect(output.nextIdealSky).not.toBeNull();
    const next = output.nextIdealSky as Record<string, unknown>;
    expect(Object.keys(next).sort()).toEqual(['condition', 'date', 'endLocal', 'startLocal', 'type'].sort());
    expect(next.date).toBe('2026-08-01');
    expect(next.type).toBe('blueHourMorning');
    expect(next.condition).toBe('Mainly clear');
    expect(output.nextIdealSkyReason).toBeUndefined();
  });

  it('nextIdealSky: "future" is strict (end > now) -- a window ending exactly at `now` is already past', async () => {
    // The `<` vs `<=` boundary, and the one place the README's wording
    // ("strictly future") could drift from the code without any other test
    // noticing. The two windows are read out of the run's own dataset rather
    // than hardcoded, so this stays correct if the astronomy ever shifts.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z')); // before the whole 7-day dataset
    await run();

    const pushed = mockedActor.pushData.mock.calls[0][0] as DatasetItem[];
    const idealWindows = pushed.filter(isWindowItem).filter((w: WindowItem) => w.idealSky);
    const [first, second] = idealWindows;
    expect(second).toBeDefined();

    mockedActor.pushData.mockClear();
    mockedActor.setValue.mockClear();
    vi.setSystemTime(new Date(first.endLocal)); // now === the first window's END, to the millisecond
    await run();

    const output = findSetValueCall('OUTPUT')![1] as Record<string, unknown>;
    const next = output.nextIdealSky as Record<string, unknown>;
    expect(next.startLocal).toBe(second.startLocal);
    expect(next.startLocal).not.toBe(first.startLocal);
  });

  it('nextIdealSky: now after every ideal-sky window has ended -> null + reason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T00:00:00Z')); // after the whole 7-day dataset

    await run();

    const outputCall = findSetValueCall('OUTPUT');
    const output = outputCall![1] as Record<string, unknown>;
    expect(output.nextIdealSky).toBeNull();
    expect(typeof output.nextIdealSkyReason).toBe('string');
    expect((output.nextIdealSkyReason as string).toLowerCase()).toContain('passed');
  });

  it('nextIdealSky: no ideal-sky window anywhere in the 7 days -> null + reason (same shape as the "all passed" case)', async () => {
    mockedFetchHourlyWeather.mockResolvedValue(forecast(NO_IDEAL_SAMPLES));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));

    await run();

    const outputCall = findSetValueCall('OUTPUT');
    const output = outputCall![1] as Record<string, unknown>;
    expect(output.nextIdealSky).toBeNull();
    expect(typeof output.nextIdealSkyReason).toBe('string');
    expect((output.nextIdealSkyReason as string).toLowerCase()).toContain('no ideal-sky windows');
  });
});
