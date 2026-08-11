import { afterEach, describe, expect, it, vi } from 'vitest';

import { __clearFormatterCacheForTests, formatIsoLocal, midpoint, overlapsHour } from '../src/time.js';

// The formatter cache is module-level, so it outlives each test: a test stubbing
// `Intl` would inherit whatever an earlier one cached for the same zone, which
// today works only because every test happens to pick a fresh zone name.
// Clearing it makes zone choice free for the next author rather than a hidden rule.
afterEach(() => {
    __clearFormatterCacheForTests();
});

describe('formatIsoLocal', () => {
    it('formats a UTC instant in America/Los_Angeles (PDT, -07:00 in August)', () => {
        // 2026-08-02T03:31:00Z = 2026-08-01T20:31:00-07:00
        const d = new Date('2026-08-02T03:31:00Z');
        expect(formatIsoLocal(d, 'America/Los_Angeles')).toBe('2026-08-01T20:31:00-07:00');
    });

    it('formats UTC itself with a +00:00 offset', () => {
        const d = new Date('2026-08-02T03:31:00Z');
        expect(formatIsoLocal(d, 'UTC')).toBe('2026-08-02T03:31:00+00:00');
    });

    it('formats a half-hour-offset zone (Asia/Kolkata, +05:30)', () => {
        // 2026-08-02T03:31:00Z = 2026-08-02T09:01:00+05:30
        const d = new Date('2026-08-02T03:31:00Z');
        expect(formatIsoLocal(d, 'Asia/Kolkata')).toBe('2026-08-02T09:01:00+05:30');
    });

    it('handles the US spring-forward DST transition (2026-03-08, America/Los_Angeles)', () => {
        // In 2026, US clocks spring forward at 2026-03-08T10:00:00Z (02:00 PST -> 03:00 PDT).
        // Just before: 09:59:59Z = 01:59:59-08:00 (PST).
        const before = new Date('2026-03-08T09:59:59Z');
        expect(formatIsoLocal(before, 'America/Los_Angeles')).toBe('2026-03-08T01:59:59-08:00');
        // At/after the jump: 10:00:00Z = 03:00:00-07:00 (PDT) - 02:xx never exists that day.
        const after = new Date('2026-03-08T10:00:00Z');
        expect(formatIsoLocal(after, 'America/Los_Angeles')).toBe('2026-03-08T03:00:00-07:00');
    });

    it('handles the US fall-back DST transition (2026-11-01, America/Los_Angeles)', () => {
        // Clocks fall back at 2026-11-01T09:00:00Z (02:00 PDT -> 01:00 PST).
        // Just before: 08:59:59Z = 01:59:59-07:00 (PDT, first pass through 01:xx).
        const before = new Date('2026-11-01T08:59:59Z');
        expect(formatIsoLocal(before, 'America/Los_Angeles')).toBe('2026-11-01T01:59:59-07:00');
        // At the jump: 09:00:00Z = 01:00:00-08:00 (PST, second pass through 01:xx).
        const atJump = new Date('2026-11-01T09:00:00Z');
        expect(formatIsoLocal(atJump, 'America/Los_Angeles')).toBe('2026-11-01T01:00:00-08:00');
    });

    // Every other test here starts from a cleared cache and formats one zone, so
    // this is the only place a mis-keyed cache would show up.
    it('formats a second zone as itself, not with the first zone cached formatter', () => {
        const d = new Date('2026-08-02T03:31:00Z');

        expect(formatIsoLocal(d, 'Europe/Lisbon')).toBe('2026-08-02T04:31:00+01:00');
        expect(formatIsoLocal(d, 'Asia/Tokyo')).toBe('2026-08-02T12:31:00+09:00');
    });

    describe('UTC-offset extraction from the platform longOffset string', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        /**
         * Stubs `Intl.DateTimeFormat` so `formatToParts` returns chosen parts. A
         * `function` rather than an arrow because `formatterFor` calls it with
         * `new`, and arrows are not constructible.
         */
        function stubParts(parts: { type: string; value: string }[]): void {
            vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
                return { formatToParts: () => parts } as never;
            } as never);
        }

        function stubTimeZoneName(timeZoneName: string): void {
            stubParts([
                { type: 'year', value: '2026' },
                { type: 'month', value: '08' },
                { type: 'day', value: '02' },
                { type: 'hour', value: '03' },
                { type: 'minute', value: '31' },
                { type: 'second', value: '00' },
                { type: 'timeZoneName', value: timeZoneName },
            ]);
        }

        it('maps a bare "GMT" (some ICU builds report UTC this way) to an explicit +00:00', () => {
            stubTimeZoneName('GMT');
            // Zone name is arbitrary here -- the stub controls what ICU "returns".
            expect(formatIsoLocal(new Date('2026-08-02T03:31:00Z'), 'Zone/Bare-GMT')).toBe('2026-08-02T03:31:00+00:00');
        });

        it('throws rather than emitting a malformed timestamp for an unrecognized longOffset', () => {
            // The regression guarded: passing the raw value through produced
            // "2026-08-02T03:31:00PDT", which looks ISO-8601, does not parse, and
            // would be silently mis-read by every consumer.
            stubTimeZoneName('PDT');
            expect(() => formatIsoLocal(new Date('2026-08-02T03:31:00Z'), 'Zone/Weird')).toThrow(/PDT/);
            expect(() => formatIsoLocal(new Date('2026-08-02T03:31:00Z'), 'Zone/Weird')).toThrow(/Zone\/Weird/);
        });

        it('still throws on a missing wall-clock part, before it ever reaches the offset', () => {
            stubParts([
                { type: 'year', value: '2026' },
                { type: 'timeZoneName', value: 'GMT+00:00' },
            ]);
            expect(() => formatIsoLocal(new Date('2026-08-02T03:31:00Z'), 'Zone/Partial')).toThrow(/month/);
        });
    });
});

describe('midpoint', () => {
    it('returns the instant halfway between two dates', () => {
        const a = new Date('2026-08-02T20:00:00Z');
        const b = new Date('2026-08-02T21:00:00Z');
        // A literal instant: restating `(a + b) / 2` here would assert nothing.
        expect(midpoint(a, b).getTime()).toBe(new Date('2026-08-02T20:30:00Z').getTime());
    });
});

describe('overlapsHour', () => {
    const hourStart = new Date('2026-08-02T20:00:00Z'); // hour = [20:00, 21:00)

    it('is true for a window that partially overlaps the start of the hour', () => {
        const start = new Date('2026-08-02T19:30:00Z');
        const end = new Date('2026-08-02T20:10:00Z');
        expect(overlapsHour(hourStart, start, end)).toBe(true);
    });

    it('is true for a window that partially overlaps the end of the hour', () => {
        const start = new Date('2026-08-02T20:50:00Z');
        const end = new Date('2026-08-02T21:30:00Z');
        expect(overlapsHour(hourStart, start, end)).toBe(true);
    });

    it('is false for a window that starts exactly at the hour end', () => {
        const start = new Date('2026-08-02T21:00:00Z');
        const end = new Date('2026-08-02T22:00:00Z');
        expect(overlapsHour(hourStart, start, end)).toBe(false);
    });

    it('is false for a window that ends exactly at the hour start', () => {
        const start = new Date('2026-08-02T19:00:00Z');
        const end = new Date('2026-08-02T20:00:00Z');
        expect(overlapsHour(hourStart, start, end)).toBe(false);
    });
});
