/**
 * Open-Meteo forecast API client: hourly weather code, cloud-cover layers and
 * precipitation probability over the 7-day horizon, normalized into
 * `HourlySample[]` plus the IANA zone `timezone=auto` resolved.
 *
 * `forecast_days=7` is pinned rather than trusting the API's default to stay 7.
 *
 * Every hourly variable is independently optional -- a missing array yields
 * `null` for that field on every sample -- except that `weather_code` and all
 * the cloud-cover variables missing together leaves no condition signal at all
 * and hard-fails.
 *
 * A boundary function -- `main.ts` calls it directly -- so it may fail the run as
 * a side effect. See AGENTS.md.
 */
import { gotScraping } from '@crawlee/utils';
import { Actor, log } from 'apify';

import { foldResponseBodyIntoMessage } from './errors.js';
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
    weather_code?: (number | null)[];
    cloud_cover?: (number | null)[];
    cloud_cover_low?: (number | null)[];
    cloud_cover_mid?: (number | null)[];
    cloud_cover_high?: (number | null)[];
    precipitation_probability?: (number | null)[];
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

/** One hour's value, tolerating an array the response omitted entirely. */
function valueAt(arr: (number | null)[] | undefined, index: number): number | null {
    if (!arr) return null;
    const value = arr[index];
    return value ?? null;
}

/**
 * Fetches the 7-day hourly forecast and normalizes it into `HourlySample[]` plus
 * the response's resolved IANA timezone.
 *
 * One coordinate object, never two positional numbers: `tsc` cannot catch a
 * swapped `(longitude, latitude)` pair, and the failure mode is a confident
 * report about the wrong place.
 *
 * A missing `timezone` is not a hard failure here -- failing when there is no
 * other source for one is the caller's job.
 *
 * @throws Error if both `weather_code` and every cloud-cover variable are
 *   missing, or if the hourly array's length/contiguity guard fails.
 */
export async function fetchHourlyWeather(coordinates: {
    latitude: number;
    longitude: number;
}): Promise<{ samples: HourlySample[]; timezone: string | null }> {
    try {
        const { latitude, longitude } = coordinates;
        const url = buildForecastUrl(latitude, longitude);

        // All three options below are duplicated from `geocode.ts` on purpose; see
        // AGENTS.md, "There is no HTTP module". `throwHttpErrors` is the
        // load-bearing one: `gotScraping` ships `false`, so without it Open-Meteo's
        // `{"error":true,"reason":"..."}` payload arrives as an ordinary response and
        // fails below as "missing the hourly block".
        const { body } = await gotScraping({
            url,
            responseType: 'json',
            throwHttpErrors: true,
            // Ceiling on a Retry-After: a rate-limit reply naming an hour would
            // otherwise be an hour of billed container time.
            retry: { maxRetryAfter: 10_000 },
            hooks: { beforeError: [foldResponseBodyIntoMessage] },
        });

        const response = body as ForecastResponse;
        const { hourly } = response;

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
    } catch (reason) {
        // Narrowing, not coercion: nothing on this path throws a non-Error, and
        // rethrowing the impossible case lands it where an unwrapped failure
        // would land anyway.
        if (!(reason instanceof Error)) throw reason;
        // The status message carries the text -- got errors arrive with the
        // response body already folded in -- and only the log carries the stack.
        log.exception(reason, reason.message);
        await Actor.fail(reason.message, { exitCode: 1 });
        // Unreachable in production -- `fail` ends in `process.exit` -- but real
        // under the SDK's `isExiting` guard, where `fail` returns normally.
        throw reason;
    }
}
