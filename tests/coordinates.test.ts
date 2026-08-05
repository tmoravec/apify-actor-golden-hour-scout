import { describe, it, expect } from 'vitest';
import { parseCoordinates, CoordinateParseError } from '../src/coordinates.js';

describe('parseCoordinates', () => {
  it('parses decimal degrees, comma-separated', () => {
    const result = parseCoordinates('37.7456, -119.5936');
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  it('parses decimal degrees, whitespace-separated (no comma)', () => {
    const result = parseCoordinates('37.7456 -119.5936');
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  it('parses decimal degrees with hemisphere letters after the number', () => {
    const result = parseCoordinates('37.7456 N, 119.5936 W');
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  it('parses decimal degrees with hemisphere letters before the number', () => {
    const result = parseCoordinates('N 37.7456, W 119.5936');
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  // Whitespace separation must work for the hemisphere-AFTER forms too, not
  // just hemisphere-before: the README promises "a comma or whitespace"
  // unconditionally, and `37.7456 N 119.5936 W` was previously rejected while
  // its mirror `N 37.7456 W 119.5936` parsed. These rows pin the whole
  // token-regrouping contract so the two orders can't drift apart again.
  it.each([
    ['hemisphere after both, no comma', '37.7456 N 119.5936 W'],
    ['hemisphere before both, no comma', 'N 37.7456 W 119.5936'],
    ['mixed order: before on latitude, after on longitude', 'N 37.7456 119.5936 W'],
    ['mixed order: after on latitude, before on longitude', '37.7456 N W 119.5936'],
    ['hemisphere on latitude only, no comma', '37.7456 N -119.5936'],
    ['hemisphere on longitude only, no comma', '37.7456 119.5936 W'],
  ])('parses whitespace-separated components: %s', (_label, input) => {
    const result = parseCoordinates(input);
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  it('rejects whitespace-separated token runs that do not land on exactly two components', () => {
    expect(() => parseCoordinates('37.7456 N 119.5936 W 100')).toThrow(CoordinateParseError);
    expect(() => parseCoordinates('37.7456 N W')).toThrow(CoordinateParseError); // letter with no number to bind to
    expect(() => parseCoordinates('N 37.7456')).toThrow(CoordinateParseError); // one component, no sibling
  });

  it('parses degrees decimal minutes (DDM), comma-separated, hemisphere before', () => {
    const result = parseCoordinates('N 37° 44.736, W 119° 35.616');
    expect(result.latitude).toBeCloseTo(37.7456, 3);
    expect(result.longitude).toBeCloseTo(-119.5936, 3);
  });

  it('parses degrees minutes seconds (DMS), whitespace-separated, hemisphere after', () => {
    const result = parseCoordinates(`37°44'44"N 119°35'37"W`);
    expect(result.latitude).toBeCloseTo(37.7456, 2);
    expect(result.longitude).toBeCloseTo(-119.5936, 2);
  });

  // DMS accepts the Unicode prime U+2032 as a minutes marker; DDM must too.
  // They share a minutes field, and a paste from a tool that emits typographic
  // primes shouldn't parse with seconds but fail without them.
  it.each([
    ['ASCII apostrophe', "37° 44.736', 119° 35.616' W"],
    ['Unicode prime U+2032', '37° 44.736′, 119° 35.616′ W'],
    ['no minutes marker at all', '37° 44.736, 119° 35.616 W'],
  ])('parses DDM minutes written with %s', (_label, input) => {
    const result = parseCoordinates(input);
    expect(result.latitude).toBeCloseTo(37.7456, 3);
    expect(result.longitude).toBeCloseTo(-119.5936, 3);
  });

  // A colon standing in for `°` is a real convention (some GPS tools emit
  // "37:44.736"), and the parser has always accepted it. It is now documented
  // in ACCEPTED_FORMATS_MESSAGE, so it is a contract rather than an accident:
  // this row is what stops a future "tighten the regex" from silently
  // reinterpreting a user's coordinates as unparseable.
  it('accepts a colon as a stand-in for the degree sign, as documented in the error text', () => {
    const result = parseCoordinates('37:44.736 N, 119:35.616 W');
    expect(result.latitude).toBeCloseTo(37.7456, 3);
    expect(result.longitude).toBeCloseTo(-119.5936, 3);
  });

  it('handles southern/eastern hemispheres correctly', () => {
    const result = parseCoordinates('33.8688 S, 151.2093 E');
    expect(result.latitude).toBeCloseTo(-33.8688, 6);
    expect(result.longitude).toBeCloseTo(151.2093, 6);
  });

  it('resolves negative-number + hemisphere conflicts by letting the hemisphere win', () => {
    // Numeric sign says south/negative, hemisphere says north -> hemisphere wins (positive).
    const result = parseCoordinates('-37.7456 N, 119.5936 W');
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  it('is consistent when negative number and hemisphere agree', () => {
    const result = parseCoordinates('-37.7456 S, -119.5936 W');
    expect(result.latitude).toBeCloseTo(-37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  // The out-of-range messages name the offending value and its valid range --
  // a documented quality bar, so the TEXT is pinned, not just the error class.
  // A regression that fell back to the generic parse message would otherwise
  // pass unnoticed.
  // A hemisphere on only ONE component is a very natural paste (many tools
  // print the letter on latitude only). The lettered component claims its
  // axis; the bare signed number takes the other and keeps its own sign.
  it.each([
    ['hemisphere on latitude only', '37.7456 N, -119.5936'],
    ['hemisphere on longitude only', '37.7456, 119.5936 W'],
    ['hemisphere on longitude only, longitude first', '119.5936 W, 37.7456'],
    ['hemisphere-before on latitude only', 'N 37.7456, -119.5936'],
  ])('parses a mixed hemisphere/bare-number pair: %s', (_label, input) => {
    const result = parseCoordinates(input);
    expect(result.latitude).toBeCloseTo(37.7456, 6);
    expect(result.longitude).toBeCloseTo(-119.5936, 6);
  });

  it('still rejects two components on the same axis, which no bare number can disambiguate', () => {
    // The mixed form above must not be widened into accepting this: there is
    // no bare component here, so the latitude is simply unidentified.
    expect(() => parseCoordinates('37 N, 119 N')).toThrow(CoordinateParseError);
    expect(() => parseCoordinates('37 E, 119 W')).toThrow(CoordinateParseError);
  });

  it('rejects out-of-range latitude, naming the value and its range', () => {
    expect(() => parseCoordinates('95, -119.5936')).toThrow(CoordinateParseError);
    expect(() => parseCoordinates('95, -119.5936')).toThrow(/Latitude 95 is out of range \(-90 to 90\)/);
  });

  it('rejects out-of-range longitude, naming the value and its range', () => {
    expect(() => parseCoordinates('37.7456, -190')).toThrow(CoordinateParseError);
    expect(() => parseCoordinates('37.7456, -190')).toThrow(/Longitude -190 is out of range \(-180 to 180\)/);
  });

  it('rejects garbage input with an error naming all four accepted formats', () => {
    let thrown: unknown;
    try {
      parseCoordinates('somewhere over the rainbow');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CoordinateParseError);
    const message = (thrown as Error).message;
    expect(message).toMatch(/decimal/i);
    expect(message).toMatch(/hemisphere/i);
    expect(message).toMatch(/degrees decimal minutes|DDM/i);
    expect(message).toMatch(/degrees minutes seconds|DMS/i);
    // The colon stand-in for `°` is accepted by the parser (see the test
    // above), so the message has to name it for the accepted set to be
    // discoverable from the error alone.
    expect(message).toMatch(/colon/i);
  });

  it('rejects empty input', () => {
    expect(() => parseCoordinates('')).toThrow(CoordinateParseError);
  });

  // Structurally-malformed inputs that parse far enough to reach a specific
  // rejection branch, rather than failing at the first regex like garbage text.
  // Each one previously reached an untested `return null` / `throw`.
  it.each([
    ['three comma-separated components', '37.7456, -119.5936, 100'],
    ['one component carrying two hemisphere letters', 'N 37.5 S, 119 W'],
    ['both components on the latitude axis', '37 N, 119 N'],
    ['both components on the longitude axis', '37 E, 119 W'],
    ['a lone component with no sibling', '37.7456'],
  ])('rejects %s', (_label, input) => {
    expect(() => parseCoordinates(input)).toThrow(CoordinateParseError);
  });
});
