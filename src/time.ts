/**
 * Timezone-aware local ISO-8601 formatting plus small time-interval helpers.
 *
 * All user-facing times must render in the location's local timezone with an
 * explicit UTC offset -- never bare Z, never the runner's own local time.
 */

const PART_TYPES = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

/**
 * One formatter per IANA zone, built lazily.
 *
 * A run formats roughly six strings per window plus one per day, all for the
 * same one or two zones, and `Intl.DateTimeFormat` construction is by far the
 * expensive half of the call. The options are a fixed literal, so the
 * formatter depends only on `timeZone` and is safe to reuse: `formatToParts`
 * does not mutate it. The key space is bounded by the zones a run actually
 * touches (in practice, one).
 *
 * Admittedly a micro-optimisation but since it already exists and works well,
 * it stays.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

/**
 * Test-only escape hatch. The cache is module-level and therefore shared by
 * every test in a file; a test that stubs `Intl` for one zone would otherwise
 * inherit whatever an earlier test cached for that zone. Never called by
 * production code.
 */
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
 * Formats a UTC instant as an ISO-8601 string in the given IANA timezone's
 * local wall-clock time, with an explicit numeric UTC offset
 * (e.g. "2026-08-01T20:31:00-07:00"), built on Intl.DateTimeFormat with
 * timeZoneName: 'longOffset' so DST transitions resolve correctly for the
 * zone in question.
 *
 * @throws Error if the platform's ICU yields a `longOffset` this cannot turn
 *   into a numeric offset -- see the offset parsing below.
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

  // timeZoneName 'longOffset' yields e.g. "GMT+05:30", "GMT+00:00", "GMT-07:00",
  // and on some ICU builds a bare "GMT" for UTC itself.
  //
  // Anything else is a hard failure rather than a pass-through: emitting the
  // raw value would splice a non-offset (e.g. "GMT" mid-string, or a zone
  // abbreviation) onto the end of the timestamp and produce a string that
  // LOOKS like ISO-8601 but does not parse. Every consumer here --
  // `new Date(...)` in svg.ts/main.ts, the dataset, the report -- would then
  // silently mis-handle it. Failing loudly is the only safe option.
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

/** The instant exactly halfway between two dates. */
export function midpoint(a: Date, b: Date): Date {
  return new Date((a.getTime() + b.getTime()) / 2);
}

/**
 * True iff the half-open hourly interval [hourStart, hourStart + 1h)
 * intersects the half-open window [start, end). Partial overlap counts; a
 * window that starts exactly at the hour's end, or ends exactly at the
 * hour's start, does not overlap.
 */
export function overlapsHour(hourStart: Date, start: Date, end: Date): boolean {
  const hourStartMs = hourStart.getTime();
  const hourEndMs = hourStartMs + 60 * 60 * 1000;
  const startMs = start.getTime();
  const endMs = end.getTime();
  return startMs < hourEndMs && endMs > hourStartMs;
}
