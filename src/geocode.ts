/**
 * Open-Meteo Geocoding API client: place name -> coordinates, IANA timezone,
 * display name.
 *
 * The API returns `name`, `admin1` and `country` separately; the `name` handed
 * back here is the composite `name[, admin1][, country]`, capped, so a wrong match
 * is obvious wherever the location is echoed. The raw fields travel too.
 */
import { gotScraping } from '@crawlee/utils';

import { foldResponseBodyIntoMessage, InputError, truncateWithEllipsis } from './errors.js';
import type { TargetLocation } from './types.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// The composite is the Actor's only unbounded display string -- it leads the run's
// status message and is echoed on every dataset item and the report header -- so
// it is capped here, at the one place it is composed, rather than at each of
// those surfaces. `admin1`/`country` travel uncapped on purpose: nothing
// recomposes them, and capping the parts as well as the composite would bound the
// same text twice.
const MAX_DISPLAY_NAME = 120;

interface GeocodeResult {
    name: string;
    latitude: number;
    longitude: number;
    /**
     * Optional, and not by pedantry: a result with no `timezone` is a real
     * response shape (`test/fixtures/geocode-missing-timezone.json`). Declared
     * `string`, it made `formatIsoLocal(d, geocoded.timezone)` typecheck and
     * then throw `RangeError: Invalid time zone specified: undefined`.
     */
    timezone?: string;
    admin1?: string;
    country?: string;
}

interface GeocodeResponse {
    results?: GeocodeResult[];
}

/**
 * Resolves a free-text place name to a `TargetLocation`. First result wins.
 *
 * `TargetLocation` rather than `GeoLocation` because a result carrying no
 * `timezone` is a supported response shape, and its `timezone: string | null`
 * is the "not settled yet" state `resolveLocation` fills from the forecast's
 * `timezone=auto` read-back.
 *
 * @throws InputError when the API returns zero results.
 */
export async function geocode(placeName: string): Promise<TargetLocation> {
    const url = new URL(GEOCODING_URL);
    url.searchParams.set('name', placeName);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');

    // All three options below are duplicated in `weather.ts` on purpose; see
    // AGENTS.md, "There is no HTTP module". `throwHttpErrors` is not a redundant
    // default: `gotScraping` ships it `false`, right for a crawler reading a 404
    // page and wrong for an API client. Retries and backoff are got's own.
    const { body } = await gotScraping({
        url: url.toString(),
        responseType: 'json',
        throwHttpErrors: true,
        // Ceiling on a Retry-After: a rate-limit reply naming an hour would
        // otherwise be an hour of billed container time.
        retry: { maxRetryAfter: 10_000 },
        hooks: { beforeError: [foldResponseBodyIntoMessage] },
    });

    const response = body as GeocodeResponse;
    const first = response.results?.[0];

    if (!first) {
        throw new InputError(
            `No geocoding results found for "${placeName}". Check the spelling of the place name, or use the ` +
                `"coordinates" input field instead to bypass geocoding entirely.`,
        );
    }

    return {
        name: truncateWithEllipsis(
            [first.name, first.admin1, first.country].filter((part): part is string => Boolean(part)).join(', '),
            MAX_DISPLAY_NAME,
        ),
        admin1: first.admin1,
        country: first.country,
        latitude: first.latitude,
        longitude: first.longitude,
        timezone: first.timezone ?? null,
    };
}
