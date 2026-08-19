/**
 * The Actor's error surface: the `InputError` class that drives the exit code,
 * the two message helpers its callers share, and got's `beforeError` hook. One
 * file deliberately -- none of the four earns a module of its own.
 *
 * Failing the run is not here: each boundary function called from `main.ts`
 * catches and calls `Actor.fail` itself, so there is no shared failure helper to
 * hold. See AGENTS.md.
 */
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

/**
 * Caps `text` at `limit` UTF-16 code units, the ellipsis included.
 *
 * Nothing caps a status message as a whole any more. Instead the two strings
 * that reach one with no bound of their own are capped where they are produced,
 * and both call this: geocoding's composite display name (`geocode.ts`) and the
 * response body the hook below folds into a failure message.
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

// A response body is the one unbounded, possibly multi-line part of a failure
// message: Open-Meteo's own rejection is a short JSON line, but a 502/503 from a
// CDN or proxy in front of it is a multi-KB HTML page. Since the message becomes
// the run's status message verbatim, the cap is applied here, at the origin.
const MAX_FOLDED_BODY = 500;

/**
 * got's message stops at the status line, and @apify/log renders an error's
 * stack, `type`, `details` and `cause` but never its other fields -- so
 * Open-Meteo's `{"error":true,"reason":"..."}` body would otherwise never reach
 * the operator. A got hook rather than a catch at the entry point: rendering a
 * transport error belongs to the transport.
 *
 * The body is folded in as a single capped line: newlines are unreadable in a
 * Console status message, and an unbounded body would evict got's own status
 * line from the operator's view of it.
 */
export function foldResponseBodyIntoMessage(error: RequestError): RequestError {
    const rawBody = error.response?.rawBody;
    // `?.length`, not truthiness: `rawBody` is a `Buffer`, and an empty one is
    // truthy -- a bare `if (rawBody)` appends a dangling `": "` to every
    // empty-bodied 4xx.
    if (!rawBody?.length) return error;

    const body = truncateWithEllipsis(
        String(rawBody)
            .replace(/\s*\n+\s*/g, ' ')
            .trim(),
        MAX_FOLDED_BODY,
    );
    // eslint-disable-next-line no-param-reassign -- mutate and return, per got's own beforeError contract
    error.message = `${error.message}: ${body}`;
    return error;
}
