/**
 * Reader/validator for the `coordinates` input object: `{ latitude, longitude }`
 * in decimal degrees.
 *
 * Coordinate *strings* are deliberately not parsed -- no DMS, no hemisphere
 * letters. Two typed number fields turn a typo into a schema error instead of a
 * plausible misparse pointing at the wrong hemisphere; see AGENTS.md.
 *
 * `.actor/input_schema.json` states the same type and range rules, but a local
 * run or a hand-rolled API call reaches this code without the platform's
 * validation ever running.
 */

import { describeValue, InputError } from './errors.js';

export interface Coordinates {
    latitude: number;
    longitude: number;
}

/** A malformed `coordinates` input. Subclasses `InputError`, so it exits 2. */
export class CoordinateInputError extends InputError {
    constructor(message: string) {
        super(message);
        this.name = 'CoordinateInputError';
    }
}

/**
 * Exported so `test/input-schema.test.ts` can hold `.actor/input_schema.json`'s
 * nested `minimum`/`maximum` to the range enforced here.
 */
export const AXES = [
    { key: 'latitude', min: -90, max: 90, example: 37.7456 },
    { key: 'longitude', min: -180, max: 180, example: -119.5936 },
] as const;

const AXIS_KEYS: readonly string[] = AXES.map((axis) => axis.key);

const EXAMPLE_OBJECT = '{"latitude": 37.7456, "longitude": -119.5936}';

/** "Left blank" in every form the field arrives in, the empty string a cleared control sends included. */
function isUnset(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Mostly for getting human readable error messages.
 */
export function readCoordinatesInput(value: unknown): Coordinates | null {
    if (isUnset(value)) return null;

    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new CoordinateInputError(
            `\`coordinates\` must be an object with numeric \`latitude\` and \`longitude\` fields, ` +
                `e.g. ${EXAMPLE_OBJECT} — got ${describeValue(value)}.`,
        );
    }

    const record = value as Record<string, unknown>;

    // A misspelled key ("lat"/"lon") would otherwise look identical to an empty
    // section and quietly geocode `location` instead.
    const unknownKeys = Object.keys(record).filter((key) => !AXIS_KEYS.includes(key));
    if (unknownKeys.length > 0) {
        throw new CoordinateInputError(
            `\`coordinates\` has unrecognised field(s) ${unknownKeys.map((k) => `\`${k}\``).join(', ')}. ` +
                `Only \`latitude\` and \`longitude\` are accepted, e.g. ${EXAMPLE_OBJECT}.`,
        );
    }

    const set = AXES.filter((axis) => !isUnset(record[axis.key]));
    if (set.length === 0) return null;
    if (set.length < AXES.length) {
        const missing = AXES.filter((axis) => isUnset(record[axis.key]));
        throw new CoordinateInputError(
            `\`coordinates\` is missing ${missing.map((axis) => `\`${axis.key}\``).join(' and ')}. ` +
                'Set both latitude and longitude, or leave both empty to geocode `location` instead.',
        );
    }

    for (const axis of AXES) {
        const raw = record[axis.key];
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            throw new CoordinateInputError(
                `\`coordinates.${axis.key}\` must be a number in decimal degrees (e.g. ${axis.example}) — ` +
                    `got ${describeValue(raw)}.`,
            );
        }
        if (raw < axis.min || raw > axis.max) {
            throw new CoordinateInputError(
                `\`coordinates.${axis.key}\` ${raw} is out of range (${axis.min} to ${axis.max}).`,
            );
        }
    }

    return { latitude: record.latitude as number, longitude: record.longitude as number };
}
