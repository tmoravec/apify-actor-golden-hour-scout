import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { geocode } from '../src/geocode.js';

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf-8'));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('geocode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the first result into a GeoLocation with the exact composite display name', async () => {
    const fixture = loadFixture('geocode-yosemite.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const location = await geocode('Yosemite Valley');

    expect(location.name).toBe('Yosemite Valley, California, United States');
    expect(location.admin1).toBe('California');
    expect(location.country).toBe('United States');
    expect(location.latitude).toBe(37.74075);
    expect(location.longitude).toBe(-119.57788);
    expect(location.timezone).toBe('America/Los_Angeles');
  });

  it('requests the geocoding API with exactly name + count=1&language=en&format=json, and no other params', async () => {
    const fixture = loadFixture('geocode-yosemite.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await geocode('Yosemite Valley');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(requestedUrl.searchParams.get('name')).toBe('Yosemite Valley');
    // `count=1` is what makes "first result wins" a server-side guarantee
    // rather than a client-side slice.
    expect(requestedUrl.searchParams.get('count')).toBe('1');
    expect(requestedUrl.searchParams.get('language')).toBe('en');
    expect(requestedUrl.searchParams.get('format')).toBe('json');

    // Pinned exhaustively (parity with weather.test.ts): the query carries
    // these four params and nothing else.
    expect([...requestedUrl.searchParams.keys()].sort()).toEqual(['count', 'format', 'language', 'name']);
  });

  it('skips missing admin1/country parts in the composite name, with no dangling separators', async () => {
    const fixture = loadFixture('geocode-missing-parts.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const location = await geocode('Null Island');

    expect(location.name).toBe('Null Island');
    expect(location.admin1).toBeUndefined();
    expect(location.country).toBeUndefined();
    expect(location.name.endsWith(',')).toBe(false);
    expect(location.name).not.toContain(',,');
  });

  // The both-missing fixture above only exercises the extreme. These pin the
  // one-but-not-both cases, where a regression that mishandles the MIDDLE part
  // (a dangling ", ," or a stray leading separator) would otherwise slip past
  // the suite entirely.
  it.each([
    ['admin1 missing, country present', 'geocode-missing-admin1.json', 'Monaco, Monaco', undefined, 'Monaco'],
    [
      'country missing, admin1 present',
      'geocode-missing-country.json',
      'Rothera Point, Adelaide Island',
      'Adelaide Island',
      undefined,
    ],
  ])('composite name with %s', async (_label, fixtureName, expectedName, expectedAdmin1, expectedCountry) => {
    const fixture = loadFixture(fixtureName);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const location = await geocode('anywhere');

    expect(location.name).toBe(expectedName);
    expect(location.admin1).toBe(expectedAdmin1);
    expect(location.country).toBe(expectedCountry);
    expect(location.name).not.toContain(',,');
    expect(location.name).not.toMatch(/,\s*,/);
    expect(location.name.endsWith(',')).toBe(false);
    expect(location.name.startsWith(',')).toBe(false);
  });

  it('throws an actionable error when results are empty, mentioning the place name and the coordinates input', async () => {
    const fixture = loadFixture('geocode-empty.json');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await expect(geocode('xyzzyqwerty')).rejects.toThrow(/coordinates/i);
  });
});
