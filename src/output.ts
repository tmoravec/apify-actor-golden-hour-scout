/**
 * The report's key-value-store key, the next ideal-sky window, and the run's
 * terminal status message composed from them.
 *
 * No `OUTPUT` record, deliberately -- see AGENTS.md.
 */
import type { DatasetItem, GeoLocation, WindowItem } from './types.js';
import { isWindowItem } from './types.js';

/**
 * The key `report.html` is stored under. Spelled independently in
 * `.actor/output_schema.json`'s `template`, which `test/output-schema.test.ts`
 * checks against this constant -- a third spelling would break the Output-tab
 * preview with no error anywhere.
 */
export const REPORT_KEY = 'report.html';

/**
 * The first ideal-sky window that hasn't ended yet. Having none at all and
 * having them all elapsed both return `null` plus a reason, differing only in
 * that text.
 *
 * Feeds `buildStatusMessage` and nothing else: since the dataset is not filtered
 * by `now`, a consumer re-derives this from `idealSky` and `endLocal` whenever it
 * asks, which beats a snapshot taken at run time.
 */
export function buildNextIdealSky(
    items: DatasetItem[],
    now: Date,
): { nextIdealSky: WindowItem | null; nextIdealSkyReason?: string } {
    const idealWindows = items.filter(isWindowItem).filter((w) => w.idealSky);
    // A no-op today, since `buildWindows` emits chronologically and `filter`
    // preserves order. It stays so that "the first future ideal window" is a
    // property of this function rather than of its caller's emission order.
    const future = idealWindows
        .filter((w) => new Date(w.endLocal).getTime() > now.getTime())
        .sort((a, b) => new Date(a.startLocal).getTime() - new Date(b.startLocal).getTime());

    const next = future[0];
    if (next) return { nextIdealSky: next };

    const reason =
        idealWindows.length === 0
            ? 'No ideal-sky windows in the 7-day forecast.'
            : 'All ideal-sky windows in the 7-day forecast have already passed.';
    return { nextIdealSky: null, nextIdealSkyReason: reason };
}

/**
 * The run's terminal, user-visible status message, per
 * `actor-whitepaper/README.md:1143`'s "the end user should never need to look
 * into the log". Location, window count, then either the next ideal-sky window
 * or the reason there is none -- never a dangling "Next ideal sky:".
 *
 * Composed raw: every part is bounded and single-line by construction. The
 * counts, the type enum and the ISO date are bounded by their own shapes, the
 * two reason strings are literals above, and the one part with no bound of its
 * own -- a geocoded composite name -- is capped where it is composed, in
 * `geocode.ts`.
 *
 * The only place the Actor reports anything relative to `now`.
 */
export function buildStatusMessage(items: DatasetItem[], location: GeoLocation, now: Date): string {
    const windowCount = items.filter(isWindowItem).length;
    const { nextIdealSky, nextIdealSkyReason } = buildNextIdealSky(items, now);
    const nextIdealSkyPart = nextIdealSky
        ? `Next ideal sky: ${nextIdealSky.type} on ${nextIdealSky.date}.`
        : (nextIdealSkyReason ?? '');

    return (
        `${location.name}: ` +
        `${windowCount} photography window${windowCount === 1 ? '' : 's'} ` +
        `over the next 7 days. ${nextIdealSkyPart}`
    );
}
