/**
 * Resolves the Actor's run target: raw `getInput()` shape in, a geocoded or
 * `coordinates`-derived location out, and (once the forecast responds) the
 * final `GeoLocation` with its timezone settled.
 */
import { readCoordinatesInput } from './coordinates.js';
import { describeValue, InputError } from './errors.js';
import { geocode } from './geocode.js';
import type { GeoLocation, TargetLocation } from './types.js';

export interface Input {
    // `unknown`, not the schema's types: this is whatever `Actor.getInput()`
    // handed back, and the validators below are what narrow it.
    location?: unknown;
    coordinates?: unknown;
}

/**
 * Resolves the run's target: a filled-in `coordinates` pair is used as-is,
 * skipping geocoding and leaving `timezone` null. Otherwise geocodes
 * `location`, which supplies the timezone directly.
 *
 * Takes `getInput()`'s raw result, `null` included, so that "nothing was
 * provided" is decided inside a tested function rather than by a `?? {}` in
 * `main.ts`. Empty input is an error, not a default.
 */
export async function resolveTarget(input: Input | null): Promise<TargetLocation> {
    const coordinates = readCoordinatesInput(input?.coordinates);
    if (coordinates) {
        const { latitude, longitude } = coordinates;
        // No place record on this path, so the formatted pair is the display
        // name -- which keeps a mistyped coordinate visible in the report.
        return { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude, timezone: null };
    }

    // Type-checked for the same reason `readCoordinatesInput` re-checks its
    // fields: without the platform's validation, `"type": "string"` is not a
    // runtime guarantee. Unchecked, a number reaches `.trim()` and fails on exit
    // 1 with a `TypeError` -- no help to the user, and the wrong side of the
    // input/world exit-code split. `null` is not a type error: like an absent
    // field or an empty string it means "left blank", handled below.
    const rawLocation = input?.location ?? undefined;
    if (rawLocation !== undefined && typeof rawLocation !== 'string') {
        throw new InputError(
            '`location` must be a place name string (e.g. "Yosemite Valley, California") — got ' +
                `${describeValue(rawLocation)}.`,
        );
    }

    const placeName = rawLocation?.trim();
    if (!placeName) {
        throw new InputError(
            'No location given: set `location` to a place name (e.g. "Yosemite Valley, California"), or fill in ' +
                'both `coordinates.latitude` and `coordinates.longitude` (e.g. 37.7456 and -119.5936).',
        );
    }
    return geocode(placeName);
}

/**
 * Settles the final timezone: geocoding's zone wins, otherwise (the
 * `coordinates` path) the forecast's `timezone=auto` read-back. No zone fails
 * the run rather than defaulting -- times silently rendered in the wrong zone
 * are worse than no report.
 */
export function resolveLocation(target: TargetLocation, forecastTimezone: string | null): GeoLocation {
    const timezone = target.timezone ?? forecastTimezone;
    if (!timezone) {
        throw new Error(
            `Could not resolve a timezone for coordinates ${target.latitude}, ${target.longitude}: the Open-Meteo ` +
                'forecast response carried no "timezone" field despite being requested with timezone=auto.',
        );
    }
    return { ...target, timezone };
}
