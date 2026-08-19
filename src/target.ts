/**
 * Resolves the Actor's run target: raw `getInput()` shape in, a geocoded or
 * `coordinates`-derived location out, and (once the forecast responds) the
 * final `GeoLocation` with its timezone settled.
 *
 * Both functions here are boundary functions -- `main.ts` calls them directly --
 * so both may fail the run as a side effect. `main.ts` carries no try/catch and
 * no listeners, so a failure that is not ended here reaches the platform as a
 * bare stack with the generic FAILED message. See AGENTS.md.
 */
import { Actor, log } from 'apify';

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
 *
 * Fails the run rather than only throwing. This is the one boundary function
 * where both exit codes are reachable -- its own validation and geocoding's
 * zero-results case are the user's to fix (2); a transport or HTTP failure out
 * of `geocode` is the world misbehaving (1) -- so it is the one carrying the
 * branch.
 */
export async function resolveTarget(input: Input | null): Promise<TargetLocation> {
    try {
        const coordinates = readCoordinatesInput(input?.coordinates);
        if (coordinates) {
            const { latitude, longitude } = coordinates;
            // No place record on this path, so the formatted pair is the display
            // name -- which keeps a mistyped coordinate visible in the report.
            return { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude, timezone: null };
        }

        // Type-checked for the same reason `readCoordinatesInput` re-checks its
        // fields: without the platform's validation, `"type": "string"` is not a
        // runtime guarantee. Unchecked, a number reaches `.trim()` and fails on
        // exit 1 with a `TypeError` -- no help to the user, and the wrong side of
        // the input/world exit-code split. `null` is not a type error: like an
        // absent field or an empty string it means "left blank", handled below.
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
        return await geocode(placeName);
    } catch (reason) {
        // Narrowing, not coercion: nothing on this path throws a non-Error, and
        // rethrowing the impossible case lands it where an unwrapped failure
        // would land anyway.
        if (!(reason instanceof Error)) throw reason;
        // The status message carries the text; only the log carries the stack.
        log.exception(reason, reason.message);
        await Actor.fail(reason.message, { exitCode: reason instanceof InputError ? 2 : 1 });
        // Unreachable in production -- `fail` ends in `process.exit` -- but real
        // under the SDK's `isExiting` guard, where `fail` returns normally.
        // Without it this resolves `undefined` and `main.ts` runs on garbage.
        throw reason;
    }
}

/**
 * Settles the final timezone: geocoding's zone wins, otherwise (the
 * `coordinates` path) the forecast's `timezone=auto` read-back. No zone fails
 * the run rather than defaulting -- times silently rendered in the wrong zone
 * are worse than no report.
 *
 * `async` only so it can await `Actor.fail`; nothing here does I/O. The exit
 * code is the literal 1, not the branch `resolveTarget` carries: the only
 * failure reachable here is Open-Meteo answering without a field it was asked
 * for, which is not the user's input to fix.
 */
export async function resolveLocation(target: TargetLocation, forecastTimezone: string | null): Promise<GeoLocation> {
    try {
        const timezone = target.timezone ?? forecastTimezone;
        if (!timezone) {
            throw new Error(
                `Could not resolve a timezone for coordinates ${target.latitude}, ${target.longitude}: the Open-Meteo ` +
                    'forecast response carried no "timezone" field despite being requested with timezone=auto.',
            );
        }
        return { ...target, timezone };
    } catch (reason) {
        if (!(reason instanceof Error)) throw reason;
        log.exception(reason, reason.message);
        await Actor.fail(reason.message, { exitCode: 1 });
        throw reason;
    }
}
