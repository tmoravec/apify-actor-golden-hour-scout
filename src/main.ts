/**
 * Actor entry point. Flat top-level statements only, so the whole run -- input,
 * process, output -- reads without scrolling past a declaration. This file
 * carries no unit tests, so nothing here may branch or build a string; anything
 * with logic lives in a tested module. Enforced by
 * `test/source-invariants.test.ts`.
 */
import { Actor } from 'apify';

import { failRun } from './errors.js';
import { buildStatusMessage, REPORT_KEY } from './output.js';
import { renderReport } from './report/render.js';
import type { Input } from './target.js';
import { resolveLocation, resolveTarget } from './target.js';
import { fetchHourlyWeather } from './weather.js';
import { buildWindows } from './windows.js';

// Listeners rather than a wrapper, so the flow below stays flat statements.
// Node routes an entry-module top-level-await rejection to `uncaughtException`;
// registering the other event costs one line.
process.on('uncaughtException', failRun);
process.on('unhandledRejection', failRun);

await Actor.init();

// The codebase's only bare `new Date()`, threaded explicitly from here.
const now = new Date();

// The raw `getInput()` result, null included: "nothing was provided" is
// `resolveTarget`'s decision to make, not this file's.
const target = await resolveTarget(await Actor.getInput<Input>());
const { samples, timezone } = await fetchHourlyWeather(target);
const location = resolveLocation(target, timezone);

// ALL windows, elapsed ones included -- the dataset is never filtered by `now`.
const items = buildWindows(samples, location);
await Actor.pushData(items);

// A helper file, not the run's output: the dataset above is that, and there is
// deliberately no `OUTPUT` record.
await Actor.setValue(REPORT_KEY, renderReport(items, { location }), { contentType: 'text/html' });

await Actor.exit(buildStatusMessage(items, location, now));
