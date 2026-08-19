# Golden Hour Scout — agent guide

An Apify Actor: one location in, 7 days of golden/blue-hour photography windows
out. `README.md` holds the user-facing input/output contract. This file is the
maintainer's half — the conventions and the deliberate decisions that someone
reading only the code would mistake for bugs.

## Commands

```bash
npm test             # vitest run — unit + integration, fully offline
npm run typecheck    # tsc -p tsconfig.test.json --noEmit
npm run build        # tsc -> dist/
npm run lint         # eslint
npm run format:check # prettier --check .
npm start            # dev runner (tsx src/main.ts) — iteration only
npm run start:prod   # node dist/main.js — the shipped entry point
apify run            # real end-to-end run against Open-Meteo (needs a build first)
```

`apify run` reads a **tracked** input, `storage/key_value_stores/default/INPUT.json`,
so a fresh clone runs without setup — the one path `.gitignore` negates out of an
otherwise-ignored `storage/`. Scratch input, not a fixture; no test reads it.

## Hard constraints

- **No API keys, no sign-ups, no paid services.** Open-Meteo's free tier is the
  only data source. Never add a dependency or endpoint that needs a key.
- Four runtime deps (`apify`, `@crawlee/utils`, `got-scraping`, `suncalc`); a
  fifth needs a real reason. The two HTTP ones come in transitively via `apify`
  anyway and are declared only because we import them directly (`gotScraping` as
  the transport; `RequestError` as a **type-only** import in `src/errors.ts`).
- `report.html` is **self-contained**: inline CSS and SVG only, no CDN, no
  webfont, no remote image, well under 1 MB. The single permitted external
  reference is the Open-Meteo attribution link — a CC BY 4.0 licence term, not
  decoration. Never drop it from the footer.

## Invariants

**`src/main.ts` is wiring only.** Flat top-level statements: no `function`,
`=>`, `class`, `try`, and no branches or string building either — the file
carries no unit tests, so anything with logic lives in a module that does. It is
imports, `Actor.init()`, the calls, and `Actor.exit(<status message>)` — no error
boundary of any kind. `test/source-invariants.test.ts` enforces the keywords;
ternaries and template literals are beyond a text check and stay prose-enforced
here.

**Wall clock.** Exactly one `new Date()` exists in the codebase — a top-level
statement in `main.ts`, threaded explicitly from there. Never call `new Date()`
or `Date.now()` anywhere else; take a `now: Date` parameter. Output must be a
function of input alone. Also pinned by `test/source-invariants.test.ts`.

**Times.** Every emitted timestamp is location-local ISO-8601 with an explicit
numeric UTC offset. Never bare `Z`, never the runner's zone. Format through
`src/time.ts`.

**Solar day.** `getSunEvents` (`src/astronomy.ts`) takes the day's **local
noon** and shifts it by the longitude (`lon / 15` hours) before handing it to
suncalc. Both halves are load-bearing and both fail silently — suncalc rounds
its input to the nearest UTC noon to pick a solar day, so a bad input returns
the neighbouring day's geometry. This shipped once, making every
`Pacific/Auckland` window in NZDT a full day early while `date` stayed correct.
Derivation and verification sweep are in `getSunEvents`' doc comment. Local noon
does **not** generally share its UTC calendar date with the day's solar events;
that false premise is what the bug rested on.

**The dataset is never filtered by `now`.** All 7 local days always ship,
elapsed windows included, and every day appears even when it has no windows.
The status message's next-ideal-sky line is the only future-only thing the
Actor produces, and it is a message, not data.

**Timezone resolution.** Geocoding supplies the zone; the `coordinates` path has
no place record, so the forecast's `timezone=auto` read-back fills it
(`resolveLocation`, `src/target.ts`). A missing zone **fails the run** — never
default to UTC or the runner's zone, because times silently rendered in the
wrong zone are worse than no report. Both producers of an unsettled zone return
`TargetLocation` (`timezone: string | null`, in `src/types.ts`): keep that state
in the type, not a comment, or `formatIsoLocal` typechecks and then throws
`RangeError: Invalid time zone specified: undefined`.

**Location input has no default.** `location` in `.actor/input_schema.json` is a
`prefill`, never a `default` — an emptied box must not silently geocode a
hardcoded place, because the run costs the user money.
`coordinates.latitude`/`longitude` carry neither, for that reason plus one more:
a prefilled pair would outrank `location` on every run that never opened the
section.

## Deliberate decisions — do not "fix" these

### Windows and data

- **`date` is the solar day**, not `startLocal`'s calendar date. Above ~60° an
  evening window can end after local midnight, so `endLocal` may carry the next
  date while `date` does not. An evening shoot that spills past midnight still
  belongs to that evening.
- **`noWindows` is not `polar`.** A sub-polar summer day with a real sunrise and
  sunset on which the sun never reaches the golden/blue boundaries gets
  `type: "noWindows"`. Calling it polar would be factually wrong.
- **Ideal sky requires all four cloud figures in band simultaneously**, and a
  missing figure counts as unknown rather than 0% — an incomplete forecast
  yields no ideal-sky windows instead of a verdict on partial data.
- **`precipProb` is on the report card but is not part of the ideal-sky rule.**
  `isIdealSky` reads the midpoint hour's WMO code, which states whether
  precipitation is falling _at that hour_; a probability is a different kind of
  claim. It is on the card (`renderPrecipProb`, `src/report/render.ts`) exactly
  because the two can disagree — ★ on a dry code with a high chance of rain
  around it.

### HTTP

- **There is no HTTP module, and the four `gotScraping` options are duplicated
  in `geocode.ts` and `weather.ts` on purpose.** A shared wrapper was tried and
  removed: with retries delegated to got it carried too little to earn a file.
  Do not reintroduce one, and do not park the options in `types.ts` either. A
  third call site must repeat all of them.
- **`throwHttpErrors: true` is not a redundant default.** `gotScraping` ships it
  as `false` — right for a crawler reading a 404 page, wrong for an API client.
  Without it Open-Meteo's `{"error":true,"reason":"..."}` 400 arrives as an
  ordinary response and fails later as "missing the hourly block". Shipped wrong
  once already.
- **No retry loop.** got's defaults are the policy (3 attempts, exponential
  backoff, 429 + transient 5xx + transport errors, `Retry-After` honoured); a
  hand-rolled loop would nest inside got's, not replace it.
  **`retry.maxRetryAfter`** bounds how long a `Retry-After` can park the run —
  otherwise a rate-limit reply naming an hour bills an hour of container time.
- **The response body reaches the log via got's `beforeError` hook, not an error
  boundary.** got's `HTTPError` message stops at the status line and @apify/log
  renders only `stack`/`type`/`details`/`cause`, so the `reason` payload would
  never reach the operator. `foldResponseBodyIntoMessage` (`src/errors.ts`)
  mutates the message in place; wired into both call sites' got options. No
  `instanceof HTTPError` narrowing is needed — got hands the hook only its own
  errors.

### Failure path and status messages

- **Each boundary function fails the run itself; there is no shared failure
  helper and no boundary in `main.ts`.** The three functions `main.ts` calls that
  can fail — `resolveTarget`, `resolveLocation` (`src/target.ts`) and
  `fetchHourlyWeather` (`src/weather.ts`) — each wrap their whole body in the
  same shape:

    ```ts
    } catch (reason) {
        if (!(reason instanceof Error)) throw reason;
        log.exception(reason, reason.message);
        await Actor.fail(reason.message, { exitCode: 1 });
        throw reason;
    }
    ```

    Do not extract that into a helper — a helper is the old `failRun` renamed, and
    the same stance applies as to the deliberately duplicated got options. What is
    duplicated is the _shape_, not the exit code: **`resolveTarget` alone**
    replaces the literal with `reason instanceof InputError ? 2 : 1`, because it is
    the only site where both outcomes are reachable (its own validation and
    geocoding's zero-results case are `InputError`s; a transport or HTTP failure
    out of `geocode` is not). A ternary at the other two sites would ship
    untested. Each site's exit code is pinned by tests asserting `Actor.fail`'s
    arguments.

    The three are the codebase's only impure-by-design functions. `buildWindows`,
    `renderReport` and `buildStatusMessage` stay pure — do not wrap them; a throw
    there is a bug, not a run outcome.

- **`throw reason` after `await Actor.fail` is not dead code.** In production
  `fail` → `exit` → `process.exit`, so it never runs. But `Actor.exit`'s
  `isExiting` re-entrancy guard makes `fail` **return normally** when an exit is
  already in flight (the SDK's own abort handler, for one); without the rethrow
  the function resolves `undefined` and `main.ts` continues on garbage. In that
  race the process ends on node's code 1 rather than the mapped code — accepted.
- **Accepted gap: a rejecting `Actor.fail` also drops the mapped exit code.**
  `exit` sets `isExiting = true` before `await events.close()`, and its own
  `process.exit(exitCode)` — both the 30 s timer and the `.catch` on the
  listener-drain promise — is registered only _after_ that await. So a rejecting
  final `PERSIST_STATE` listener (or a throwing sync `exit` listener) propagates
  out of `Actor.fail`, past the `throw reason` above, to `main.ts`'s top-level
  await: node prints the stack and exits 1, collapsing an `InputError`'s 2.
  Everything from the timer down is covered twice and is not exposed —
  `waitForAllListenersToComplete`, `client.teardown` and `setStatusMessage` may
  all reject safely. Accepted rather than guarded: the run is FAILED either way,
  the status message is unset on this path regardless (`exit` sets it after the
  throw point), and `log.exception` has already logged the real cause before the
  `fail` call. A `.catch(() => process.exit(exitCode))` at each of the three
  sites would buy back one integer in that race; a shared guard is `failRun`
  renamed, which the bullet above rules out.
- **Accepted gap: failures outside those three functions carry no status
  message.** A rejection from `Actor.init`, `Actor.pushData`, `Actor.setValue`,
  or a bug in the pure pipeline reaches node's default top-level-await handling:
  stack to stderr, exit 1, run FAILED with the platform's generic message. No
  TIMED-OUT hang, and exit 1 is the right code for all of them. Two caveats:
    - `pushData`/`setValue` are the likeliest of these to fire, and are left
      unwrapped on purpose — they hit Apify's own retried API, and a custom
      message would restate what a generic FAILED already conveys. If that
      judgment proves wrong, the fix is a tested `publishOutputs(items, location)`
      in `src/output.ts` wrapping both calls with the same catch, not a listener.
    - This path prints a raw stack via node, bypassing `apify/log`'s credential
      censoring. A documented exception to the "always use `apify/log`" guidance
      below, low-risk because nothing on this path handles a token.
- **No `aborting` handler is registered, deliberately.** The SDK installs one at
  `init()` unless `gracefulShutdown: false`, so Apify's graceful-abort guidance
  is already satisfied; ours would add an arrow function to `main.ts`, which the
  wiring-only invariant forbids anyway.
- **Every terminal state a boundary function reaches carries a status message** —
  per the whitepaper, the end user should never need the log to understand what
  happened. `InputError` (and `CoordinateInputError`) means unusable user input
  and exits **2**; everything else means the world misbehaved and exits **1**;
  success exits **0**.
- **Status messages are composed raw — nothing caps or reformats them centrally.
  Boundedness is by construction, at each origin.** Our own throws are short,
  single-line literals. The two strings that arrive unbounded are capped where
  they are produced, both via `truncateWithEllipsis` (`src/errors.ts`):
  geocoding's composite `name, admin1, country` at composition (`geocode.ts`,
  120), and a failed response's body in `foldResponseBodyIntoMessage`, which also
  collapses its newlines (500) — Open-Meteo's rejection is a short JSON line, but
  a 502 from a proxy in front of it is a multi-KB HTML page. If a new unbounded
  source ever appears, cap it at its origin; do not reintroduce a global
  formatter. Capping the geocoded name at composition means it is the same
  bounded string in the status message, every dataset item and the report header.
- **The `Actor.fail({ statusMessage, exitCode: 2 })` trap:** with a single object
  argument, `fail` calls `exit(messageOrOptions, { exitCode: 1, ...options })`
  and `exit` merges `{ ...messageOrOptions, ...options }`, so `exitCode: 1`
  always wins. **The two-argument string form is not affected** — with a string
  first, `exit` builds `{ ...options, statusMessage }` and the caller's
  `exitCode` survives. Use `Actor.fail(message, { exitCode })`, as all three
  boundary functions do.

### Output surfaces

- **There is no `OUTPUT` key-value-store record, and re-adding one is a
  regression.** The dataset is the whole machine-readable output — every Console
  view, export format and integration reads it, so a JSON singleton beside it is
  a second place to look that most consumers never will. The removed record's
  three fields each have a cheaper home: `location` is on every dataset item;
  the report URL is `output_schema.json`'s `template` in Console and
  `<store>/records/report.html` over the API (see README); `nextIdealSky` is
  re-derivable from `idealSky` and `endLocal`, which beats a run-time snapshot
  that is never updated — and it cannot be a dataset item, since a run-level
  singleton would be a fourth item shape breaking `DATASET_ITEM_KEYS`, the
  schema, the views and the CSV columns.
- **`report.html` is surfaced through `.actor/output_schema.json`'s `template`
  only**, resolved server-side for the Console Output tab. One artifact, one
  conveyance. **The Actor never mutates key-value-store permissions** either:
  making the record tokenless is an operator decision, documented not automated.
- **The report is a pure function of the dataset.** Elapsed windows draw exactly
  like upcoming ones; nothing on the page depends on when it was rendered. It
  renders thresholds from `IDEAL_SKY_BANDS` and its code table from
  `WMO_LABEL_TABLE` (`src/wmo.ts`), never as retyped prose: the page must not be
  able to state a threshold the code doesn't apply.
- **`buildNextIdealSky` (`src/output.ts`) sorts an already-sorted list**, so
  "the first future ideal window" is a property of the function rather than an
  accident of `buildWindows`' emission order (`test/output.test.ts` pins it with
  unsorted input). It returns the `WindowItem` itself, not a field subset.

### Input handling

- **`coordinates` is an object of two `number` fields, not a coordinate
  string.** The old string parser (decimal/DDM/DMS/hemisphere) is gone
  deliberately: two range-checked number inputs turn a typo into a schema error
  instead of a plausible misparse pointing at the wrong hemisphere. Do not
  re-add string coercion to `src/coordinates.ts` — not even for `"37.7456"`.
  `readCoordinatesInput` still re-validates everything the schema states,
  because local runs and hand-rolled API calls reach it unvalidated.
- **A half-filled or invalid `coordinates` fails the run**; it never falls back
  to geocoding `location`. Reporting on a different place than the one the user
  entered coordinates for is the worst available outcome. Blank in all its forms
  (absent, `null`, `{}`, empty strings) is the _only_ thing that reaches the
  `location` path — so an unrecognised key like `lat`/`lon` is an error, not an
  empty section.
- **Both `Input` fields are typed `unknown`, and `location`'s type is re-checked
  in `resolveTarget`** — without platform validation, `"type": "string"` is a
  declaration, not a runtime guarantee. Unchecked, `{"location": 42}` reached
  `.trim()` and failed on exit **1** with a `TypeError`: no help to the user,
  wrong side of the input/world exit-code split. `null` there means "left
  blank", not a type error.
- **The `coordinates` path uses formatted lat/lon as the display name**, so a
  mistyped pair stays obvious in the report header, every item's `location`, and
  the status message. The section sits behind a `sectionCaption` so the place
  name stays the ordinary way in.
- **The nested `properties` carry no `required` array.** JSON Schema would read
  it as "if the object is present, both fields must be", and Console sending an
  untouched section as `{}` would then block plain `location` runs. The
  both-or-neither rule is enforced in `readCoordinatesInput`, with a better
  message than the platform validator's.

### Three hardenings that exist because `main.ts` has no unit tests

Each is exactly the kind of thing a later reader might "simplify" back — don't.

- **`fetchHourlyWeather` (`src/weather.ts`) takes one `{ latitude, longitude }`
  object, never two positional numbers.** `tsc` cannot catch a swapped
  positional pair, and the failure mode is a confident report about the wrong
  place.
- **`REPORT_KEY` (`src/output.ts`) is a constant**, not a literal repeated at
  its two spellings (`main.ts`'s `setValue` and `output_schema.json`'s
  `template`). A third spelling would break the Output-tab preview with no error
  anywhere.
- **`resolveTarget` (`src/target.ts`) accepts `Input | null`.** "Nothing was
  provided" is decided inside a tested function, not by a `?? {}` in untested
  wiring.

### Dataset schema

- **`.actor/dataset_schema.json`'s `fields` describes all three item shapes with
  one permissive object**, not a `oneOf` per shape, so `required` names only
  `date`, `type`, `location` and each per-shape field says in its `description`
  where it appears. A strict variant schema would reject the `polar`/`noWindows`
  items a high-latitude run legitimately emits, and Console's field UI does not
  traverse `oneOf`. Console reads this file for field docs and generated API
  examples — keep descriptions accurate.
- **Timestamp columns use the `text` display format, never `date`.** In a view's
  `display.properties`, `format` is Apify's cell-renderer enum, not a JSON type;
  Console's `date` renderer would re-display the value in the _viewer's_ zone,
  destroying the explicit UTC offset these strings exist to carry.
  `date`/`startLocal`/`endLocal` stay `text`; `idealSky` is `boolean`. (In
  `fields`, those same timestamps are `"type": "string"` with JSON Schema's
  annotation-only `"format": "date-time"`.)

## Tests

`npm test` is **offline**. Every test stubs the network; no test may make a real
request. `vi.mock('@crawlee/utils', () => ({ gotScraping: vi.fn() }))` plus JSON
fixtures from `test/fixtures/` covers `geocode.ts` and `weather.ts`; the mock
resolves `{ body }`, the only part of got's response either module reads.
Fixtures deliberately cover degraded shapes (`forecast-gap`,
`forecast-missing-*`, `forecast-wrong-count`, `geocode-*`) — add one rather than
hand-building a malformed response inline.

- **The zone axis is swept, not sampled** — `test/windows.test.ts`'s "across the
  UTC offset range" describe and the matching table in `astronomy.test.ts`.
  Hand-picked offsets are how the solar-day bug shipped. A new row needs only a
  name; `expectWindowInvariants` carries the assertions: `startLocal`'s date
  **is** `date` (only `endLocal` may roll over), and the midpoint the weather
  join reads falls inside the forecast's hourly span. The second fails silently —
  an out-of-span midpoint still resolves to `samples[0]` via
  `findClosestSample`, so `condition`/`wmoCode`/`idealSky` describe hours never
  forecast while every field looks well-formed. The invariants assume the zone
  belongs to the longitude — true of every real IANA zone, and deliberately not
  of `LOCATION_UTC`.
- **Known gap:** mocking `gotScraping` means no test exercises a real non-2xx
  response — exactly how a missing `throwHttpErrors: true` shipped once.
  `geocode.test.ts` and `weather.test.ts` each assert `throwHttpErrors: true`,
  `hooks.beforeError` and `retry.maxRetryAfter` on the options handed to got (a
  new call site needs its own copy of all three), but that checks the options
  are set, not that a 400 throws. Closing it properly needs a loopback
  `node:http` server, which the offline rule rules out — reopen that trade-off
  before adding one.
- **`src/main.ts` is not unit-tested**, per team practice (unit-test functions,
  verify the Actor with real platform runs) and because importing a top-level
  program runs it. `test/pipeline.test.ts` covers what `apify run` can't reach
  offline: the pure composition (`buildWindows` → `renderReport` →
  `buildStatusMessage`) produces a 7-day, 28-item dataset with no mocks, and the
  status message names a window actually in it.
- **The boundary functions are the exception to "rarely mocked"** —
  `test/target.test.ts` and `test/weather.test.ts` stub `apify` as
  `{ Actor: { fail }, log: { exception } }` to pin which status message and exit
  code each failure hands `Actor.fail`, since the mapping is inline at each site
  rather than in one tested function. The stub resolves, which is also the SDK's
  `isExiting` case, so the rethrow runs and every `rejects.toThrow` assertion
  still holds. Assert with `toHaveBeenCalledWith`, never
  `toHaveBeenCalledTimes` — several `it.each` rows call the function twice. Each
  suite's happy path asserts `Actor.fail` was **not** called, which is what
  catches a catch block that swallows and fails on a non-error.
  `openMeteoHttpError()` in `test/errors.test.ts` builds a **real** `HTTPError`
  and assigns `response` afterwards, since got only populates it from a genuine
  `Request`.
- **The `.actor/*.json` schemas are checked against the code**, not by
  validating emitted items (no JSON Schema validator is a dependency, by
  choice): `fields` must match `DATASET_ITEM_KEYS` both directions, the enums
  must equal `DATASET_ITEM_TYPES`/`DATASET_ITEM_REASONS`, the display formats
  above must hold, and `output_schema.json`'s `template` must match
  `REPORT_KEY`. Those `Record<Union, true>`-derived constants fail `tsc` on both
  a missing and a stray member, so a new window type can't reach the dataset
  without reaching the schema.
- `test/source-invariants.test.ts` reads `src/**/*.ts` as text to guard the two
  invariants nothing else can catch (`main.ts`'s keyword ban; the single
  `new Date()`). It scans a comment-stripped copy, since the source's own
  comments contain the strings being searched for.
- Nothing re-tests got's retry policy — asserting a dependency's defaults is
  noise. `__clearFormatterCacheForTests()` in `src/time.ts` resets the
  module-level `Intl.DateTimeFormat` cache; test-only, never call it from
  production code.

## Environment variables

**The Actor reads none.** `process.env` does not appear in `src/` — input comes
through `Actor.getInput()` and the SDK reads its own configuration. If something
ever needs a base URL again, prefer `.actor/output_schema.json`'s `template`
(resolved server-side) over reading an env var.

## Open follow-ups

Both need a real `npm run build && apify run` against Open-Meteo, which the
offline rule rules out here:

- No report screenshot is committed (it also needs a headless browser with
  system libraries unavailable here). To do it: run, open
  `storage/key_value_stores/default/report.html`, save a header/timeline crop
  under `docs/`, link it from `README.md`.
- `docs/sample-report.html` (linked from `README.md`) predates the
  chance-of-precipitation line and its footer entry, and that figure can't be
  recovered from the committed HTML — replace the file wholesale on the next
  real run rather than hand-patching it.

---

Everything above this line is this project's own guide and is authoritative;
where it conflicts with the generic Apify guidance below, the project half wins.

## Apify platform background

**Logging.** Always use `apify/log` — it censors tokens, API keys and
credentials. Levels: `debug`, `info`, `warning`/`warningOnce`, `error`,
`exception` (with stack traces), `perf`, `deprecated`, `softFail`, `internal`.

**Token.** On the platform the token is in `APIFY_TOKEN` (not
`APIFY_API_TOKEN`) and the SDK reads it automatically; locally, `apify login`
once.

**Local storage is not cloud storage.** `apify run` emulates the storage APIs in
`./storage`, which is local-only, non-persistent, reused between runs, and never
uploaded. Verify real output with `apify push` and a platform run.

**Ask before:** installing packages, `apify push`, proxy configuration changes,
Dockerfile changes, deleting datasets or key-value stores.

**CLI:** `apify <command> --help`; `run --purge` clears local storage,
`validate-schema` checks the input schema, `actor generate-schema-types`
regenerates types.

**Docs:** [llms.txt](https://docs.apify.com/llms.txt) ·
[llms-full.txt](https://docs.apify.com/llms-full.txt) ·
[crawlee.dev](https://crawlee.dev) ·
[Actor whitepaper](https://raw.githubusercontent.com/apify/actor-whitepaper/refs/heads/master/README.md)
