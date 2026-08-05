# Golden Hour Scout

An Apify Actor that takes a single location and returns the photography
shooting windows — golden hour and blue hour, morning and evening — for the
next 7 days. It combines a geocoding API, an hourly weather forecast, and
locally computed sun events, then labels every window with the forecast's
own WMO sky-condition code. Output is a structured dataset plus a
self-contained HTML report with a visual timeline.

No API keys, no sign-ups, no paid dependencies. Data: [Open-Meteo](https://open-meteo.com/).

## Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `location` | string | `"Yosemite Valley, California"` | Free-text place name, geocoded via the Open-Meteo Geocoding API. Ignored if `coordinates` is set. |
| `coordinates` | string, optional | – | If set, **overrides `location` and skips geocoding**. Accepts: <br>• Decimal degrees: `37.7456, -119.5936` <br>• Decimal with hemisphere: `37.7456 N, 119.5936 W` <br>• Degrees decimal minutes (DDM): `N 37° 44.736, W 119° 35.616` <br>• Degrees minutes seconds (DMS): `37°44'44"N 119°35'37"W` <br>Hemisphere letters may come before or after the number, and may be given on just one of the two components (`37.7456 N, -119.5936` — the bare number takes the remaining axis and keeps its own sign); separate latitude/longitude with a comma or whitespace (`37.7456 N 119.5936 W`). A colon may stand in for the degree sign (`37:44.736 N` = `37° 44.736'`). On parse failure the Actor fails fast with an error naming all four accepted formats. |

The 7-day horizon and the four window types (morning blue hour, sunrise
golden hour, sunset golden hour, evening blue hour) are not configurable.

**Coordinates-only display name**: with geocoding skipped there is no place
name to echo back, so the formatted coordinates (e.g. `"37.7456, -119.5936"`)
become the display name — a mistyped pair stays obvious in the report header
and `OUTPUT`.

## Output

### Dataset

One item per photography window, in chronological order (7 days × 4 window
types = up to 28 items; fewer near the polar circles, see below):

```json
{
  "date": "2026-08-02",
  "type": "goldenHourEvening",
  "startLocal": "2026-08-02T20:31:00-07:00",
  "endLocal": "2026-08-02T21:26:00-07:00",
  "condition": "Partly cloudy",
  "wmoCode": 2,
  "conditionSequence": ["Partly cloudy", "Partly cloudy"],
  "idealSky": true,
  "conditions": { "cloudTotal": 42, "cloudLow": 2, "cloudMid": 11, "cloudHigh": 38, "precipProb": 5 },
  "sun": { "sunrise": "2026-08-02T06:03:00-07:00", "sunset": "2026-08-02T20:11:00-07:00", "azimuthAtPeak": 290 },
  "location": { "name": "Yosemite Valley, California, United States", "latitude": 37.7456, "longitude": -119.5936, "timezone": "America/Los_Angeles" }
}
```

`type` is one of `blueHourMorning`, `goldenHourMorning`, `goldenHourEvening`,
`blueHourEvening`. `condition`/`wmoCode` are the WMO code of the hour closest
to the window's midpoint (ties go to the later hour); `conditionSequence`
lists every overlapped hour's label, duplicates kept. All times are ISO-8601
with the location's UTC offset, never bare UTC or the runner's local time.

**`date` is the solar day, not a copy of `startLocal`**: it identifies the
local day whose sun geometry produced the window. Above roughly 60° latitude
near the summer solstice, an evening window can end *after* local midnight, so
`endLocal` may carry the next calendar date while `date` does not — e.g. in
Anchorage on 2026-06-21 the `goldenHourEvening` window runs
`21:34:55-08:00` → `2026-06-22T00:46:41-08:00` with `date: "2026-06-21"`,
since an evening shoot that spills past midnight still belongs to that
evening. Read boundary dates from `startLocal`/`endLocal`, not `date`.

**Days with no windows**: all 7 local days always appear in the dataset. A day
with zero emittable windows emits exactly one explanatory item instead of the
normal shape, in one of two forms:

```json
{ "date": "2026-08-05", "type": "polar", "reason": "polar-day", "location": { "...": "..." } }
{ "date": "2026-06-21", "type": "noWindows", "reason": "no-boundary-crossings", "location": { "...": "..." } }
```

- `type: "polar"` (`reason` is `"polar-day"` or `"polar-night"`) — the sun
  never set, or never rose, at all.
- `type: "noWindows"` — an *ordinary* day, with a normal sunrise and sunset,
  on which the sun still never reaches the golden/blue-hour elevation
  boundaries, so no window has both of its crossings. This is the sub-polar
  summer case: Reykjavík on 2026-06-21 has a 02:55 sunrise and a 00:04
  sunset, and twilight lasts all night. Deliberately *not* labelled polar,
  which would be factually wrong.

Partial polar days — where only some boundary crossings occur — still emit
whatever windows exist.

**Elapsed windows are included**: all 7 local days' windows ship, including any
from *today* that had already passed when the run started. The report draws
them exactly like upcoming ones. `OUTPUT.nextIdealSky` (below) is the one field
that's future-only.

### Key-value store

- **`report.html`** — a self-contained HTML report (inline CSS/SVG only, no
  external dependency except the required Open-Meteo attribution link).
  Header with the
  resolved location and 7-day date range; one daylight band per day plus
  color-coded golden/blue-hour window bands (ideal-sky windows highlighted);
  one card per window with its times, sky condition, and cloud figures
  (high/mid/low, plus the total ruled off beneath them) as plain numbers;
  footer with the WMO code table, the ideal-sky rule, and the attribution link.
  Each day's timeline row spans that day's local midnight to midnight, so a
  band running past midnight (see the `date` note above) is drawn up to the
  day's edge with a dashed border, its full span in the tooltip. Days with no
  windows show the explanatory banner instead of a timeline row. The report is
  kept well under 1 MB. See a [sample report](docs/sample-report.html).
- **`OUTPUT`** — a JSON summary:

  ```json
  {
    "location": { "name": "Yosemite Valley, California, United States", "latitude": 37.7456, "longitude": -119.5936, "timezone": "America/Los_Angeles" },
    "reportUrl": "https://api.apify.com/v2/key-value-stores/<storeId>/records/report.html",
    "nextIdealSky": { "date": "2026-08-02", "type": "goldenHourEvening", "startLocal": "2026-08-02T20:31:00-07:00", "endLocal": "2026-08-02T21:26:00-07:00", "condition": "Partly cloudy" }
  }
  ```

  On a local run (no Apify platform), `reportUrl` is `null` and
  `reportUrlReason` explains why ("Local run — open the report from the local
  key-value store directory."). When there's no upcoming ideal-sky window —
  either none exist in the 7 days, or the ones that did have already passed —
  `nextIdealSky` is `null` and `nextIdealSkyReason` says which case applies.

  `nextIdealSky`, when present, is a five-field subset
  (`date`/`type`/`startLocal`/`endLocal`/`condition`), **not** the full
  dataset item, so the Output tab stays short.

#### Accessing `reportUrl`

`reportUrl` is a direct key-value-store record URL, readable with the run's own
API token (`?token=...` or an `Authorization` header) like any other
authenticated Apify API call.

### Sky condition & the "ideal sky" highlight

No invented categories. Every window's `condition` is the forecast's own WMO
weather code, grouped per Open-Meteo's published interpretation table; an
out-of-table code maps to `"Unknown"` with the raw code preserved, and a
missing `weather_code` maps to `"n/a"`. **Ideal sky** (`idealSky`) is one
derived highlight layered on top of that raw label — the label and the raw
cloud numbers stay visible either way.

The report's footer is the single source for the detail: the complete WMO code
table, the four cloud bands the ideal-sky rule tests and why each sits where it
does, and the one caveat the forecast data can't cover. Its thresholds are
rendered from the code that applies them, so they can't drift.

## Time zones and sun geometry

Timezones and sun events are where nearly all of this Actor's complexity lives:
DST transitions and non-hour offsets, evening windows that end after local
midnight, polar day and night, sub-polar days with a normal sunrise but no
golden hour at all, and sun math that bounds a day by UTC rather than local
date. The code handles these — the notes above cover each one — and the
ordinary mid-latitude day is the small remainder.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). The
attribution link is a licence term, and appears in the report footer as well as
here.
