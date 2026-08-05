import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fetchHourlyWeather } from '../src/weather.js';

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf-8'));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchHourlyWeather', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests exactly the 6 hourly variables + timezone=auto&timeformat=unixtime&forecast_days=7, and no other horizon params', async () => {
    const fixture = loadFixture('forecast-yosemite.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await fetchHourlyWeather(37.7456, -119.5936);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(requestedUrl.searchParams.get('latitude')).toBe('37.7456');
    expect(requestedUrl.searchParams.get('longitude')).toBe('-119.5936');

    const hourlyParam = requestedUrl.searchParams.get('hourly');
    expect(hourlyParam?.split(',')).toEqual([
      'weather_code',
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'precipitation_probability',
    ]);
    expect(requestedUrl.searchParams.get('timezone')).toBe('auto');
    expect(requestedUrl.searchParams.get('timeformat')).toBe('unixtime');
    expect(requestedUrl.searchParams.get('forecast_days')).toBe('7');

    // No other horizon-related params (e.g. start_date/end_date/past_days).
    expect(requestedUrl.searchParams.has('start_date')).toBe(false);
    expect(requestedUrl.searchParams.has('end_date')).toBe(false);
    expect(requestedUrl.searchParams.has('past_days')).toBe(false);
  });

  it('normalizes the real Yosemite fixture into 168 HourlySamples with epoch seconds converted to Date', async () => {
    const fixture = loadFixture('forecast-yosemite.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const { samples } = await fetchHourlyWeather(37.7456, -119.5936);

    expect(samples).toHaveLength(168);
    expect(samples[0].time).toBeInstanceOf(Date);
    expect(samples[0].time.getTime()).toBe(1785481200 * 1000);
    expect(samples[0].weatherCode).toBe(0);
    expect(samples[0].cloudTotal).toBe(0);
    expect(samples[0].cloudLow).toBe(0);
    expect(samples[0].cloudMid).toBe(0);
    expect(samples[0].cloudHigh).toBe(0);
    expect(samples[0].precipProb).toBe(0);
  });

  it("surfaces the response's own resolved IANA timezone alongside the samples (the coordinates path's only zone source)", async () => {
    const fixture = loadFixture('forecast-yosemite.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const { timezone } = await fetchHourlyWeather(37.7456, -119.5936);

    expect(timezone).toBe('America/Los_Angeles');
  });

  it('a response with no `timezone` field yields timezone: null rather than failing (callers decide)', async () => {
    const fixture = loadFixture('forecast-yosemite.json') as Record<string, unknown>;
    delete fixture.timezone;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const { samples, timezone } = await fetchHourlyWeather(37.7456, -119.5936);

    expect(timezone).toBeNull();
    expect(samples).toHaveLength(168);
  });

  it('missing an optional variable (precipitation_probability) yields null for that field on every sample, others still parsed', async () => {
    const fixture = loadFixture('forecast-missing-precip.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const { samples } = await fetchHourlyWeather(37.7456, -119.5936);

    expect(samples).toHaveLength(168);
    for (const s of samples) {
      expect(s.precipProb).toBeNull();
    }
    expect(samples[0].weatherCode).toBe(0);
    expect(samples[0].cloudLow).toBe(0);
  });

  it('missing weather_code AND all cloud cover variables together is a hard fail naming both signals', async () => {
    const fixture = loadFixture('forecast-missing-both.json');
    // A fresh Response per call: a single shared one has its body consumed by
    // the first read, and the second assertion would fail on that instead.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    // The message text is part of the quality bar, not incidental: it has to
    // say WHICH signals are missing, or the operator cannot act on it.
    await expect(fetchHourlyWeather(37.7456, -119.5936)).rejects.toThrow(/weather_code/);
    await expect(fetchHourlyWeather(37.7456, -119.5936)).rejects.toThrow(/cloud-cover/);
  });

  it.each([
    ['no hourly block at all', {}],
    ['an hourly block with no time array', { hourly: { weather_code: [0, 1] } }],
    ['an hourly block whose time is not an array', { hourly: { time: 1785481200 } }],
  ])('%s throws the "hourly"/"time" guard -- the first hard fail in the function', async (_label, body) => {
    // Every forecast fixture carries a valid hourly.time, so this guard --
    // which runs before the count and contiguity checks -- had no coverage.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHourlyWeather(37.7456, -119.5936)).rejects.toThrow(/hourly/);
  });

  it('a gap in the hourly array (non-contiguous, even at 168 total samples) throws an actionable error', async () => {
    const fixture = loadFixture('forecast-gap.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHourlyWeather(37.7456, -119.5936)).rejects.toThrow(/gap|contiguous|3600/i);
  });

  it('a wrong total sample count (!= 168) throws an actionable error naming the actual count', async () => {
    const fixture = loadFixture('forecast-wrong-count.json');
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHourlyWeather(37.7456, -119.5936)).rejects.toThrow(/168/);
    await expect(fetchHourlyWeather(37.7456, -119.5936)).rejects.toThrow(/100/);
  });
});
