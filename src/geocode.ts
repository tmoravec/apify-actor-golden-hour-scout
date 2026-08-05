/**
 * Open-Meteo Geocoding API client: place name -> coordinates, IANA timezone,
 * canonical display name.
 *
 * The API returns `name`, `admin1`, `country` as separate fields;
 * `GeoLocation.name` is the COMPOSITE `name[, admin1][, country]` string
 * (missing parts skipped, no dangling separators), so the resolved place is
 * echoed prominently enough that a wrong match is obvious. The raw
 * `admin1`/`country` fields are also kept on `GeoLocation`.
 */
import { fetchJsonWithRetry } from './http.js';
import type { GeoLocation } from './types.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  admin1?: string;
  country?: string;
}

interface GeocodeResponse {
  results?: GeocodeResult[];
}

/**
 * Resolves a free-text place name to a `GeoLocation`. First result wins.
 *
 * @throws Error when the API returns zero results, telling the user to check
 *   the place name or use the `coordinates` input field instead.
 */
export async function geocode(placeName: string): Promise<GeoLocation> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', placeName);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const response = (await fetchJsonWithRetry(url.toString())) as GeocodeResponse;
  const first = response.results?.[0];

  if (!first) {
    throw new Error(
      `No geocoding results found for "${placeName}". Check the spelling of the place name, or use the ` +
        `"coordinates" input field instead to bypass geocoding entirely.`,
    );
  }

  return {
    name: [first.name, first.admin1, first.country].filter((part): part is string => Boolean(part)).join(', '),
    admin1: first.admin1,
    country: first.country,
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone,
  };
}
