/**
 * The Actor's error surface: the `InputError` class, got's `beforeError` hook,
 * the pure exit-code decision, and the process-level failure listener that acts
 * on it. One file deliberately -- none of the four earns a module of its own.
 */
import { Actor, log } from 'apify';
import type { RequestError } from 'got-scraping';

/** Thrown when the run cannot proceed because of something the user gave it. Drives exit code 2. */
export class InputError extends Error {}

/**
 * Short, quoted rendering of a rejected value, for input-error messages that
 * name what arrived without pasting it wholesale. Here rather than in a caller
 * because `coordinates.ts` and `target.ts` both want the same phrasing.
 */
export function describeValue(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'object') return 'an object';
    return String(value);
}

// No API limit is documented for a status message, so this cap is ours.
const MAX_STATUS_MESSAGE = 500;

/**
 * Collapses newlines (a multi-line status message is unreadable in Console) and
 * caps the result. Shared with the success path's `buildStatusMessage`
 * (`output.ts`), which writes the same field under the same constraint.
 */
export function formatStatusMessage(message: string): string {
    return truncateWithEllipsis(message.replace(/\s*\n+\s*/g, ' ').trim(), MAX_STATUS_MESSAGE);
}

/**
 * Caps `text` at `limit` UTF-16 code units, the ellipsis included. Exported for
 * `buildStatusMessage`, which caps the location name separately before
 * composing so the overall cap can't evict the summary behind it.
 *
 * Why do we even need this? Because both `.length` and `.slice` count UTF-16
 * code units rather than characters. So an arbitrary limit can land inside
 * a surrogate pair.
 */
export function truncateWithEllipsis(text: string, limit: number): string {
    if (text.length <= limit) return text;

    const truncated = text.slice(0, limit - 1);
    const whole = /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
    return `${whole}…`;
}

// What `String()` yields for a thrown non-Error, none of it usable as the run's
// terminal status message.
const UNINFORMATIVE_STRINGIFICATIONS = new Set(['', 'undefined', 'null', '[object Object]']);

/**
 * Coerces a thrown value into an `Error` whose message says something: a
 * rejected `undefined` would otherwise reach the user as the status message
 * `undefined`, and a thrown object as `[object Object]` -- FAILED runs
 * explaining nothing, which is what the status-message convention exists to
 * prevent. Objects get one JSON attempt so their fields survive. Both coercions
 * are guarded, since a hostile `toString` or a circular reference must not throw
 * on the failure path itself.
 */
function toError(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    const stringified = coerce(() => String(reason));
    if (stringified && !UNINFORMATIVE_STRINGIFICATIONS.has(stringified)) return new Error(stringified);
    const json = coerce(() => JSON.stringify(reason));
    if (json && !UNINFORMATIVE_STRINGIFICATIONS.has(json) && json !== '{}') {
        return new Error(`The run failed with a thrown non-Error value: ${json}`);
    }
    return new Error('The run failed with a thrown value carrying no message -- see the run log for details.');
}

function coerce(stringify: () => string | undefined): string | undefined {
    try {
        return stringify();
    } catch {
        return undefined;
    }
}

/**
 * got's message stops at the status line, and @apify/log renders an error's
 * stack, `type`, `details` and `cause` but never its other fields -- so
 * Open-Meteo's `{"error":true,"reason":"..."}` body would otherwise never reach
 * the operator. A got hook rather than a catch at the entry point: rendering a
 * transport error belongs to the transport.
 */
export function foldResponseBodyIntoMessage(error: RequestError): RequestError {
    const rawBody = error.response?.rawBody;
    // `?.length`, not truthiness: `rawBody` is a `Buffer`, and an empty one is
    // truthy -- a bare `if (rawBody)` appends a dangling `": "` to every
    // empty-bodied 4xx.
    // eslint-disable-next-line no-param-reassign -- mutate and return, per got's own beforeError contract
    if (rawBody?.length) error.message = `${error.message}: ${rawBody}`;
    return error;
}

/**
 * The whole failure decision, pure so it needs no mocks to test. `InputError`
 * means the user gave us something unusable -- exit 2; everything else means the
 * world misbehaved -- exit 1.
 */
export function exitOptionsFor(reason: unknown): { statusMessage: string; exitCode: number } {
    const error = toError(reason);
    const exitCode = error instanceof InputError ? 2 : 1;
    return { statusMessage: formatStatusMessage(error.message), exitCode };
}

/**
 * The impure part. `main.ts` registers this directly on both process error
 * events -- a listener, not a wrapper, which is what lets the flow stay flat
 * statements with no block around them.
 */
export async function failRun(reason: unknown): Promise<void> {
    // Both exits below need this, and deriving it inside the `try` keeps
    // `exitOptionsFor` covered by the catch.
    let exitCode = 1;
    try {
        const error = toError(reason);
        const options = exitOptionsFor(error);
        exitCode = options.exitCode;
        log.exception(error, error.message); // the full stack, as Actor.main used to
        await Actor.exit(options);
    } catch {
        // A throw inside an `uncaughtException` handler is itself fatal and would
        // lose the failure entirely, so nothing above may go unguarded --
        // including a rejecting `events.close()` inside `Actor.exit`, which
        // leaves the SDK flagged as exiting without reaching its own exit.
        process.exit(exitCode);
    }
    // Not unreachable: `Actor.exit`'s `isExiting` guard returns normally when an
    // exit is already in flight (the SDK's own abort handler, for one). Without
    // this the process stays alive on the SDK's open handles and the platform
    // reports a timeout instead of a failure.
    process.exit(exitCode);
}
