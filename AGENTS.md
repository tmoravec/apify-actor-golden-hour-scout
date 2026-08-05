# Golden Hour Scout — agent guide

An Apify Actor: one location in, 7 days of golden/blue-hour photography windows
out. `README.md` holds the user-facing input/output contract. This file is the
maintainer's half — the conventions and the deliberate decisions that someone
reading only the code would mistake for bugs.

## Commands

```bash
npm test           # vitest, unit + integration, fully offline
npm run typecheck  # tsc --noEmit
npm run build      # tsc -p tsconfig.build.json -> dist/
npm run start:dev  # tsx src/main.ts — iteration only
apify run          # real end-to-end run against Open-Meteo (needs a build first)
```

Production runs execute the compiled `dist/main.js`. `start:dev` (tsx) is for
iteration outside the Actor harness and is never the shipped entry point.

## Hard constraints

- **No API keys, no sign-ups, no paid services.** Open-Meteo's free tier is the
  only data source. Never add a dependency or endpoint that needs a key.
- Two runtime deps (`apify`, `suncalc`). A third needs a real reason. Sun math
  stays local — not an API call.
- `report.html` is **self-contained**: inline CSS and SVG only. The one
  permitted external reference is the Open-Meteo attribution link. No CDN, no
  webfont, no remote image. Keep it well under 1 MB.
- That attribution link (CC BY 4.0) is a licence term, not decoration. Never
  drop it from the report footer.

## Invariants

**Wall clock.** Exactly one `new Date()` exists in the codebase: at the top of
`run()` in `src/main.ts`, captured before anything else and threaded explicitly
from there. Never call `new Date()` or `Date.now()` anywhere else — take a
`now: Date` parameter. Tests assert that output is a function of input alone.

**Times.** Every emitted timestamp is location-local ISO-8601 with an explicit
numeric UTC offset. Never bare `Z`, never the runner's own zone. Format through
`src/time.ts`.

**The dataset is never filtered by `now`.** All 7 local days always ship,
elapsed windows included, and every day appears even when it has no windows.
`OUTPUT.nextIdealSky` is the only future-only thing the Actor produces.

**Timezone resolution.** Geocoding supplies the zone. The `coordinates` path
has no place record, so the forecast's `timezone=auto` read-back fills it. A
missing zone fails the run — never default to UTC or the runner's zone, because
times silently rendered in the wrong zone are worse than no report.

## Deliberate decisions — do not "fix" these

- **`date` is the solar day**, not `startLocal`'s calendar date. Above ~60° an
  evening window can end after local midnight, so `endLocal` may carry the next
  date while `date` does not. An evening shoot that spills past midnight still
  belongs to that evening.
- **`noWindows` is not `polar`.** A sub-polar summer day with a real sunrise and
  sunset, on which the sun never reaches the golden/blue elevation boundaries,
  gets `type: "noWindows"`. Calling it polar would be factually wrong.
- **Ideal sky requires all four cloud figures in band simultaneously**, and a
  missing figure counts as unknown rather than 0% — so an incomplete forecast
  yields no ideal-sky windows instead of a verdict on partial data.
- **The report renders thresholds from `IDEAL_SKY_BANDS`** (`src/wmo.ts`) and
  its code table from `WMO_LABEL_TABLE`, never as retyped prose: the page must
  not be able to state a threshold the code doesn't apply. Preserve this when
  editing `src/report/render.ts`.
- **The report is a pure function of the dataset.** Elapsed windows draw exactly
  like upcoming ones; nothing about the page depends on when it was rendered.
- **`report.html` is surfaced twice on purpose.**
  `.actor/output_schema.json`'s `template` drives the Console Output-tab preview
  (resolved server-side against the run's store); `OUTPUT.reportUrl` is a plain
  JSON field for API consumers. Two conveyances of one artifact, not two
  reports.
- **The Actor never mutates key-value-store permissions.** Making `reportUrl`
  tokenless is an operator decision, documented rather than automated.
- **`buildNextIdealSky` sorts an already-sorted list.** Kept so that "the first
  future ideal window" stays a property of the field rather than an accident of
  `buildWindows`' emission order.
- **`nextIdealSky` is a five-field subset**, not the full dataset item — the
  Output tab stays short.
- **The `coordinates` path uses formatted lat/lon as the display name**, so a
  mistyped pair stays obvious in the report header and `OUTPUT`.

## Tests

`npm test` is **offline**. Every test stubs the network; no test may make a real
request.

- `vi.stubGlobal('fetch', ...)` with JSON fixtures from `tests/fixtures/` covers
  `geocode.ts`, `weather.ts`, and `http.ts`.
- `tests/main.test.ts` stubs the module boundaries (`apify`, `geocode`,
  `weather`, `http`) and runs the real `windows.ts` and `report/render.ts` for
  one integration pass.
- `src/main.ts` calls `Actor.main(run)` unconditionally at the top level, so
  importing it for its `run` export invokes `Actor.main` once at import time.
  That's why `apify` is stubbed before the import — the top-level call is the
  documented SDK pattern and is not a bug.
- `__clearFormatterCacheForTests()` in `src/time.ts` resets the module-level
  `Intl.DateTimeFormat` cache, which is otherwise shared across a file's tests.
  Test-only; never call it from production code.
- Fixtures deliberately cover degraded shapes (`forecast-gap`,
  `forecast-missing-*`, `forecast-wrong-count`, `geocode-empty`,
  `geocode-missing-*`). Add a fixture rather than hand-building a malformed
  response inline.

## Environment variables

Both are set by the Apify platform; neither needs touching for a normal run.

- `APIFY_DEFAULT_KEY_VALUE_STORE_ID` — its presence is what makes
  `OUTPUT.reportUrl` a real URL rather than `null` + `reportUrlReason`.
- `APIFY_API_BASE_URL` — base for the `reportUrl` the Actor builds; defaults to
  `https://api.apify.com`. Point it at a private endpoint for a self-hosted
  Apify installation.

## Open follow-up

No report screenshot is committed. Capturing one needs a headless browser with
system libraries that can't be installed here. To do it: `npm run build && apify
run`, open `storage/key_value_stores/default/report.html` in a browser, save a
header/timeline crop under `docs/`, and link it from `README.md`.
