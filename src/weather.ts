/**
 * Open-Meteo forecast API client: hourly weather_code + cloud-cover layers +
 * precipitation probability for the 7-day horizon, normalized into
 * `HourlySample[]` plus the IANA timezone name `timezone=auto` resolved.
 *
 * `forecast_days=7` is pinned explicitly rather than relying on the API's
 * default staying 7.
 *
 * Missing-variable tolerance: each of cloud_cover_low/mid/high and
 * precipitation_probability is independently optional -- a missing array
 * yields `null` for that field on every sample. `weather_code` is also
 * optional-tolerant BY ITSELF, but if `weather_code` AND every cloud_cover
 * variable are missing together, neither condition signal is available and
 * the request hard-fails.
 */
import { fetchJsonWithRetry } from './http.js';
import type { HourlySample } from './types.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURLY_VARIABLES = [
  'weather_code',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'precipitation_probability',
] as const;

const EXPECTED_SAMPLE_COUNT = 168;
const EXPECTED_DELTA_SECONDS = 3600;

interface ForecastHourly {
  time: number[];
  weather_code?: Array<number | null>;
  cloud_cover?: Array<number | null>;
  cloud_cover_low?: Array<number | null>;
  cloud_cover_mid?: Array<number | null>;
  cloud_cover_high?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
}

interface ForecastResponse {
  hourly?: ForecastHourly;
  /** IANA zone name resolved by `timezone=auto`, echoed back by the API. */
  timezone?: string;
}

function buildForecastUrl(latitude: number, longitude: number): string {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('hourly', HOURLY_VARIABLES.join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('forecast_days', '7');
  return url.toString();
}

/** Reads one hour's value, tolerating a missing array entirely. */
function valueAt(arr: Array<number | null> | undefined, index: number): number | null {
  if (!arr) return null;
  const value = arr[index];
  return value ?? null;
}

/**
 * Fetches the 7-day hourly forecast for the given coordinates and normalizes
 * it into `HourlySample[]` plus the response's resolved IANA timezone.
 *
 * A missing `timezone` is NOT a hard failure here; it is the caller's job to
 * fail when it has no other source for one.
 *
 * @throws Error if both `weather_code` and every cloud-cover variable are
 *   missing, or if the hourly array's length/contiguity guard fails.
 */
export async function fetchHourlyWeather(
  latitude: number,
  longitude: number,
): Promise<{ samples: HourlySample[]; timezone: string | null }> {
  const url = buildForecastUrl(latitude, longitude);
  const response = (await fetchJsonWithRetry(url)) as ForecastResponse;
  const hourly = response.hourly;

  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error('Open-Meteo forecast response is missing the "hourly" block with a "time" array.');
  }

  const weatherCodeMissing = hourly.weather_code === undefined;
  const allCloudCoverMissing =
    hourly.cloud_cover === undefined &&
    hourly.cloud_cover_low === undefined &&
    hourly.cloud_cover_mid === undefined &&
    hourly.cloud_cover_high === undefined;

  if (weatherCodeMissing && allCloudCoverMissing) {
    throw new Error(
      'Open-Meteo forecast response is missing both "weather_code" and all cloud-cover variables -- ' +
        'neither sky-condition signal is available for this location.',
    );
  }

  const count = hourly.time.length;
  if (count !== EXPECTED_SAMPLE_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_SAMPLE_COUNT} hourly samples (7 days x 24 hours) from Open-Meteo, got ${count}. ` +
        'The 7-day local-day enumeration depends on a full, contiguous 168-hour array.',
    );
  }

  for (let i = 1; i < count; i++) {
    const deltaSeconds = hourly.time[i] - hourly.time[i - 1];
    if (deltaSeconds !== EXPECTED_DELTA_SECONDS) {
      throw new Error(
        `Non-contiguous hourly array from Open-Meteo: expected a ${EXPECTED_DELTA_SECONDS}s gap between every ` +
          `consecutive sample, but found a ${deltaSeconds}s gap between index ${i - 1} ` +
          `(${new Date(hourly.time[i - 1] * 1000).toISOString()}) and index ${i} ` +
          `(${new Date(hourly.time[i] * 1000).toISOString()}).`,
      );
    }
  }

  const samples: HourlySample[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({
      time: new Date(hourly.time[i] * 1000),
      weatherCode: valueAt(hourly.weather_code, i),
      cloudTotal: valueAt(hourly.cloud_cover, i),
      cloudLow: valueAt(hourly.cloud_cover_low, i),
      cloudMid: valueAt(hourly.cloud_cover_mid, i),
      cloudHigh: valueAt(hourly.cloud_cover_high, i),
      precipProb: valueAt(hourly.precipitation_probability, i),
    });
  }

  return { samples, timezone: response.timezone ?? null };
}
