/**
 * Pure coordinate-string parser. The four accepted formats are enumerated in
 * `ACCEPTED_FORMATS_MESSAGE` below, which doubles as the parse-error text.
 *
 * Sign resolution: when a hemisphere letter is present, it determines the
 * sign (S/W negative, N/E positive) and the numeric magnitude is taken as an
 * absolute value — a literal negative sign on the number is overridden by an
 * explicit hemisphere letter (e.g. "-37.7456 N" resolves to +37.7456). When
 * no hemisphere letter is present, the number's own sign is used and its
 * position (first component = latitude, second = longitude) determines the
 * axis.
 *
 * Hemisphere letters need not be on both components: if exactly one carries a
 * letter, it claims that axis and the bare signed number takes the other one,
 * regardless of order. Two letters on the SAME axis remains an error, since
 * nothing then identifies the missing axis.
 */

const ACCEPTED_FORMATS_MESSAGE =
  'Could not parse coordinates. Accepted formats: ' +
  'decimal degrees ("37.7456, -119.5936"); ' +
  'decimal degrees with hemisphere ("37.7456 N, 119.5936 W" or "N 37.7456, W 119.5936"); ' +
  'degrees decimal minutes / DDM ("N 37° 44.736, W 119° 35.616"); ' +
  'degrees minutes seconds / DMS (\'37°44\'44"N 119°35\'37"W\'). ' +
  'Hemisphere letters may come before or after the number, and may be given on ' +
  'just one of the two components ("37.7456 N, -119.5936"); separate latitude ' +
  'and longitude with a comma or whitespace. A colon may stand in for the ' +
  'degree sign ("37:44.736 N" = 37° 44.736\'), as some tools emit.';

export class CoordinateParseError extends Error {
  constructor(message: string = ACCEPTED_FORMATS_MESSAGE) {
    super(message);
    this.name = 'CoordinateParseError';
  }
}

type Axis = 'lat' | 'lon' | null;

interface ParsedComponent {
  value: number;
  axis: Axis;
}

const HEM_LETTER = /[NSEWnsew]/;

// All compiled once at module load: the patterns are static, and hoisting them
// keeps the character classes readable side by side (see the `°`/`:` and
// `'`/`′` tolerances, which must agree between DMS and DDM).
const HEM_BEFORE_RE = new RegExp(`^(${HEM_LETTER.source})\\s*`);
const HEM_AFTER_RE = new RegExp(`\\s*(${HEM_LETTER.source})\\s*$`);
/** DMS: deg [°:] min ['′] sec ["″]? */
const DMS_RE = /^(-?\d+(?:\.\d+)?)\s*[°:]\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]?\s*$/;
/** DDM: deg [°:] min ['′]? (no seconds) */
const DDM_RE = /^(-?\d+(?:\.\d+)?)\s*[°:]\s*(\d+(?:\.\d+)?)\s*['′]?\s*$/;
/** Plain decimal degrees. */
const DECIMAL_RE = /^(-?\d+(?:\.\d+)?)\s*$/;

/** True for a token that is exactly one hemisphere letter, e.g. the "N" in "N 37.7456". */
function isLoneHemLetter(token: string): boolean {
  return token.length === 1 && HEM_LETTER.test(token);
}

/** Parses a single lat/lon component string (already isolated from its sibling). */
function parseComponent(raw: string): ParsedComponent | null {
  let s = raw.trim();
  if (s.length === 0) return null;

  let hemLetter: string | null = null;

  const hemBefore = HEM_BEFORE_RE.exec(s);
  if (hemBefore) {
    hemLetter = hemBefore[1].toUpperCase();
    s = s.slice(hemBefore[0].length);
  }

  const hemAfter = HEM_AFTER_RE.exec(s);
  if (hemAfter) {
    if (hemLetter) return null; // hemisphere specified twice - invalid
    hemLetter = hemAfter[1].toUpperCase();
    s = s.slice(0, s.length - hemAfter[0].length);
  }

  s = s.trim();
  if (s.length === 0) return null;

  let m = DMS_RE.exec(s);
  if (m) {
    return build(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), hemLetter);
  }

  m = DDM_RE.exec(s);
  if (m) {
    return build(parseFloat(m[1]), parseFloat(m[2]), 0, hemLetter);
  }

  m = DECIMAL_RE.exec(s);
  if (m) {
    return build(parseFloat(m[1]), 0, 0, hemLetter);
  }

  return null;
}

function build(deg: number, min: number, sec: number, hemLetter: string | null): ParsedComponent {
  const magnitude = Math.abs(deg) + min / 60 + sec / 3600;
  let sign: number;
  let axis: Axis = null;
  if (hemLetter) {
    sign = hemLetter === 'S' || hemLetter === 'W' ? -1 : 1;
    axis = hemLetter === 'N' || hemLetter === 'S' ? 'lat' : 'lon';
  } else {
    sign = deg < 0 ? -1 : 1;
    axis = null;
  }
  return { value: sign * magnitude, axis };
}

/** Splits the trimmed input string into two raw component substrings. */
function splitComponents(trimmed: string): [string, string] | null {
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    if (parts.length !== 2) return null;
    const [a, b] = parts.map((p) => p.trim());
    if (!a || !b) return null;
    return [a, b];
  }

  // No comma: regroup the whitespace-separated tokens into exactly two
  // components, letting a lone hemisphere letter bind to the number it
  // precedes or follows. This covers, uniformly, "37.7456 -119.5936",
  // "N 37.7456 W 119.5936", the mirror form "37.7456 N 119.5936 W", the mixed
  // forms with a letter on only one component ("37.7456 N 119.5936"), and the
  // space-free DMS form (whose tokens contain letters but are never a LONE
  // letter, so they bind to nothing).
  //
  // Binding is left-to-right and greedy: a letter that opens a component
  // claims the number after it, otherwise a number claims a letter that
  // follows it. Anything that does not land on exactly two components --
  // a trailing letter with no number, three numbers, a lone number -- is
  // rejected rather than guessed at.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const components: string[] = [];
  let i = 0;
  while (i < tokens.length && components.length <= 2) {
    if (isLoneHemLetter(tokens[i])) {
      // Hemisphere-before: needs a non-letter token to attach to.
      if (i + 1 >= tokens.length || isLoneHemLetter(tokens[i + 1])) return null;
      components.push(`${tokens[i]} ${tokens[i + 1]}`);
      i += 2;
    } else if (i + 1 < tokens.length && isLoneHemLetter(tokens[i + 1])) {
      // Hemisphere-after.
      components.push(`${tokens[i]} ${tokens[i + 1]}`);
      i += 2;
    } else {
      components.push(tokens[i]);
      i += 1;
    }
  }

  if (components.length !== 2 || i < tokens.length) return null;
  return [components[0], components[1]];
}

export function parseCoordinates(input: string): { latitude: number; longitude: number } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new CoordinateParseError();
  }

  const split = splitComponents(trimmed);
  if (!split) {
    throw new CoordinateParseError();
  }

  const [rawFirst, rawSecond] = split;
  const first = parseComponent(rawFirst);
  const second = parseComponent(rawSecond);
  if (!first || !second) {
    throw new CoordinateParseError();
  }

  let latitude: number;
  let longitude: number;

  if (first.axis || second.axis) {
    // At least one component carries an explicit hemisphere axis; use it to
    // assign lat/lon regardless of order.
    let latComp = first.axis === 'lat' ? first : second.axis === 'lat' ? second : null;
    let lonComp = first.axis === 'lon' ? first : second.axis === 'lon' ? second : null;

    // Mixed form: exactly one component names its axis and the other is a bare
    // signed number (e.g. "37.7456 N, -119.5936"). The bare component takes
    // the remaining axis and keeps its own sign. This is a very natural paste
    // from tools that print a hemisphere on latitude only, and it is
    // unambiguous -- the lettered component has already claimed its axis.
    // Note this does NOT rescue two components on the SAME axis ("37 N, 119 N"):
    // there is no bare component there, so it still fails.
    const bare = first.axis === null ? first : second.axis === null ? second : null;
    if (bare) {
      if (latComp && !lonComp) lonComp = bare;
      else if (lonComp && !latComp) latComp = bare;
    }

    if (!latComp || !lonComp) {
      throw new CoordinateParseError();
    }
    latitude = latComp.value;
    longitude = lonComp.value;
  } else {
    // No hemisphere letters anywhere: conventional order, latitude first.
    latitude = first.value;
    longitude = second.value;
  }

  if (latitude < -90 || latitude > 90) {
    throw new CoordinateParseError(
      `Latitude ${latitude} is out of range (-90 to 90). ${ACCEPTED_FORMATS_MESSAGE}`,
    );
  }
  if (longitude < -180 || longitude > 180) {
    throw new CoordinateParseError(
      `Longitude ${longitude} is out of range (-180 to 180). ${ACCEPTED_FORMATS_MESSAGE}`,
    );
  }

  return { latitude, longitude };
}
