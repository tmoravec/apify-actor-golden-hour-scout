/**
 * Timezone-aware local ISO-8601 formatting plus small time-interval helpers.
 *
 * Every user-facing time renders in the location's zone with an explicit
 * numeric UTC offset -- never bare Z, never the runner's own zone.
 */

const PART_TYPES = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

/**
 * One formatter per IANA zone, built lazily. Construction is the expensive half
 * of a format call, and a run formats ~six strings per window for the same one
 * or two zones. The options are a fixed literal, so a formatter depends only on
 * `timeZone`, and `formatToParts` does not mutate it.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

/**
 * Test-only escape hatch, never called by production code. The cache is shared
 * by every test in a file, so a test stubbing `Intl` for one zone would
 * otherwise inherit what an earlier test cached for it.
 */
// eslint-disable-next-line no-underscore-dangle -- test-only escape hatch, name is documented in AGENTS.md
export function __clearFormatterCacheForTests(): void {
    FORMATTER_CACHE.clear();
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    const cached = FORMATTER_CACHE.get(timeZone);
    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'longOffset',
    });
    FORMATTER_CACHE.set(timeZone, formatter);
    return formatter;
}

/**
 * Formats a UTC instant as local wall-clock ISO-8601 with a numeric UTC offset
 * (e.g. "2026-08-01T20:31:00-07:00"). Built on `Intl.DateTimeFormat` with
 * `timeZoneName: 'longOffset'`, so DST transitions resolve per zone.
 *
 * @throws Error if the platform's ICU yields a `longOffset` this cannot read as
 *   a numeric offset.
 */
export function formatIsoLocal(date: Date, timeZone: string): string {
    const parts = formatterFor(timeZone).formatToParts(date);
    const values: Record<string, string> = {};
    for (const part of parts) {
        values[part.type] = part.value;
    }

    for (const type of PART_TYPES) {
        if (!values[type]) {
            throw new Error(`formatIsoLocal: missing "${type}" part for timeZone "${timeZone}"`);
        }
    }

    // 'longOffset' yields e.g. "GMT+05:30", "GMT-07:00", and on some ICU builds
    // a bare "GMT" for UTC. Anything else fails hard rather than passing
    // through: splicing a non-offset onto the timestamp would produce a string
    // that looks like ISO-8601 and does not parse, which every consumer -- the
    // dataset, the report, `new Date(...)` in svg.ts -- would mis-handle.
    const rawOffset = values.timeZoneName ?? '';
    const offsetMatch = /^GMT([+-]\d{2}:\d{2})$/.exec(rawOffset);
    let offset: string;
    if (offsetMatch) {
        offset = offsetMatch[1];
    } else if (rawOffset === 'GMT') {
        offset = '+00:00';
    } else {
        throw new Error(
            `formatIsoLocal: could not read a numeric UTC offset for timeZone "${timeZone}" -- ` +
                `expected a "GMT+HH:MM"-style longOffset, got "${rawOffset}".`,
        );
    }

    return (
        `${values.year}-${values.month}-${values.day}` +
        `T${values.hour}:${values.minute}:${values.second}` +
        `${offset}`
    );
}

export function midpoint(a: Date, b: Date): Date {
    return new Date((a.getTime() + b.getTime()) / 2);
}

/**
 * True iff the half-open hour [hourStart, hourStart + 1h) intersects the
 * half-open window [start, end). Partial overlap counts; touching at an
 * endpoint does not.
 */
export function overlapsHour(hourStart: Date, start: Date, end: Date): boolean {
    const hourStartMs = hourStart.getTime();
    const hourEndMs = hourStartMs + 60 * 60 * 1000;
    const startMs = start.getTime();
    const endMs = end.getTime();
    return startMs < hourEndMs && endMs > hourStartMs;
}
