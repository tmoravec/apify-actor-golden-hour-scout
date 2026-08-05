/**
 * Actor entry point: reads input, resolves the location (geocoding or
 * `coordinates`), fetches weather, builds the window dataset, pushes it,
 * renders the report, and writes the `OUTPUT` summary.
 */
import { Actor } from 'apify';
import { parseCoordinates } from './coordinates.js';
import { geocode } from './geocode.js';
import { fetchHourlyWeather } from './weather.js';
import { buildWindows } from './windows.js';
import { renderReport } from './report/render.js';
import { isWindowItem } from './types.js';
import type { GeoLocation, DatasetItem, WindowType } from './types.js';

interface ActorInput {
  location?: string;
  coordinates?: string;
}

const DEFAULT_LOCATION = 'Yosemite Valley, California';

/**
 * Resolves the run's target: `coordinates` (if set) parses locally and skips
 * geocoding entirely -- leaving `timezone` null, since that path has no place
 * record to read an IANA zone name from. Otherwise geocodes `location` (or the
 * default place name), which supplies the timezone directly.
 */
async function resolveTarget(
  input: ActorInput,
): Promise<Omit<GeoLocation, 'timezone'> & { timezone: string | null }> {
  const coordinatesInput = input.coordinates?.trim();
  if (coordinatesInput) {
    const { latitude, longitude } = parseCoordinates(coordinatesInput);
    // No geocoding on this path, so there is no place name to echo: the
    // formatted lat/lon stands in, keeping mistyped coordinates visible.
    return { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude, timezone: null };
  }

  const placeName = input.location?.trim() || DEFAULT_LOCATION;
  return geocode(placeName);
}

/**
 * `reportUrl` formula:
 * - Platform run (`APIFY_DEFAULT_KEY_VALUE_STORE_ID` set): the record's
 *   direct API URL, readable with the run's token.
 * - Local run: `null` + a human-readable reason (no such record URL exists
 *   locally in the same way).
 */
function buildReportUrl(): { reportUrl: string | null; reportUrlReason?: string } {
  const storeId = process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
  if (storeId) {
    const base = process.env.APIFY_API_BASE_URL ?? 'https://api.apify.com';
    return { reportUrl: `${base}/v2/key-value-stores/${storeId}/records/report.html` };
  }
  return {
    reportUrl: null,
    reportUrlReason: 'Local run — open the report from the local key-value store directory.',
  };
}

/** The `OUTPUT` summary subset of a window -- deliberately not the full `WindowItem`. */
interface NextIdealSkySummary {
  date: string;
  type: WindowType;
  startLocal: string;
  endLocal: string;
  condition: string;
}

/**
 * `nextIdealSky` is strictly future (`end > now`): the first ideal-sky window
 * that hasn't ended yet. Both failure cases -- no ideal-sky windows in the 7
 * days at all, and ideal-sky windows existing but all already passed --
 * collapse to the same `null` + `nextIdealSkyReason` shape, distinguished only
 * by the reason text.
 */
function buildNextIdealSky(
  items: DatasetItem[],
  now: Date,
): { nextIdealSky: NextIdealSkySummary | null; nextIdealSkyReason?: string } {
  const idealWindows = items.filter(isWindowItem).filter((w) => w.idealSky);
  // `buildWindows` already emits chronologically and `filter` preserves order,
  // so this sort is a no-op today. It stays deliberately: "the first future
  // ideal window" is a property of `nextIdealSky`, and it shouldn't silently
  // become "whichever one `buildWindows` happened to emit first".
  const future = idealWindows
    .filter((w) => new Date(w.endLocal).getTime() > now.getTime())
    .sort((a, b) => new Date(a.startLocal).getTime() - new Date(b.startLocal).getTime());

  const next = future[0];
  if (next) {
    return {
      nextIdealSky: {
        date: next.date,
        type: next.type,
        startLocal: next.startLocal,
        endLocal: next.endLocal,
        condition: next.condition,
      },
    };
  }

  const reason =
    idealWindows.length === 0
      ? 'No ideal-sky windows in the 7-day forecast.'
      : 'All ideal-sky windows in the 7-day forecast have already passed.';
  return { nextIdealSky: null, nextIdealSkyReason: reason };
}

/**
 * The run's core logic, exported so tests can invoke it directly (with the
 * module boundaries + `Actor` stubbed) rather than through the import-time
 * `Actor.main(run)` below, which is what executes it in production.
 */
export async function run(): Promise<void> {
  // The only bare `new Date()` in the codebase -- captured once, at the very
  // top of the run, before anything else, and threaded explicitly from here.
  const now = new Date();

  const input = (await Actor.getInput<ActorInput>()) ?? {};
  const target = await resolveTarget(input);

  const { samples, timezone: forecastTimezone } = await fetchHourlyWeather(target.latitude, target.longitude);

  // Geocoding's zone wins when present; otherwise (the `coordinates` path) the
  // forecast response's own `timezone=auto` read-back supplies it. A missing
  // zone fails the run rather than defaulting -- silently rendering local times
  // in the wrong zone would be worse than no report at all.
  const timezone = target.timezone ?? forecastTimezone;
  if (!timezone) {
    throw new Error(
      `Could not resolve a timezone for coordinates ${target.latitude}, ${target.longitude}: the Open-Meteo ` +
        'forecast response carried no "timezone" field despite being requested with timezone=auto.',
    );
  }

  const location: GeoLocation = { ...target, timezone };
  const items = buildWindows(samples, location);

  // Push ALL windows/polar items, including already-passed ones -- the dataset
  // is never filtered by `now`.
  await Actor.pushData(items);

  const html = renderReport(items, { location });
  await Actor.setValue('report.html', html, { contentType: 'text/html' });

  const { reportUrl, reportUrlReason } = buildReportUrl();
  const { nextIdealSky, nextIdealSkyReason } = buildNextIdealSky(items, now);

  await Actor.setValue('OUTPUT', {
    location,
    reportUrl,
    ...(reportUrlReason ? { reportUrlReason } : {}),
    nextIdealSky,
    ...(nextIdealSkyReason ? { nextIdealSkyReason } : {}),
  });
}

// Unconditional, per the documented SDK pattern: `Actor.main` gate-keeps its
// own invocation context. Tests stub it and call `run` directly.
await Actor.main(run);
