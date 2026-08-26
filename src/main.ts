/**
 * Actor entry point. Flat top-level statements only, so the whole run -- input,
 * process, output -- reads without scrolling past a declaration. This file
 * carries no unit tests, so nothing here may branch or build a string; anything
 * with logic lives in a tested module. Enforced by
 * `test/source-invariants.test.ts`.
 *
 * No error boundary here either -- no try/catch, no process listeners. The three
 * functions below that can fail on their own (`resolveTarget`,
 * `fetchHourlyWeather`, `resolveLocation`) end the run themselves with a status
 * message and an exit code. See AGENTS.md for what that deliberately leaves
 * uncovered.
 */
import { Actor } from 'apify';

import { buildStatusMessage, REPORT_KEY } from './output.js';
import { renderReport } from './report/render.js';
import type { Input } from './target.js';
import { resolveLocation, resolveTarget } from './target.js';
import { fetchHourlyWeather } from './weather.js';
import { buildWindows } from './windows.js';

await Actor.init();

// The codebase's only bare `new Date()`, threaded explicitly from here.
const now = new Date();

const target = await resolveTarget(await Actor.getInputOrThrow<Input>());
const { samples, timezone } = await fetchHourlyWeather(target);
const location = await resolveLocation(target, timezone);

// ALL windows, elapsed ones included -- the dataset is never filtered by `now`.
const items = buildWindows(samples, location);
await Actor.pushData(items);

// A helper file, not the run's output: the dataset above is that, and there is
// deliberately no `OUTPUT` record.
await Actor.setValue(REPORT_KEY, renderReport(items, { location }), { contentType: 'text/html' });

const statusMessage = buildStatusMessage(items, location, now);
await Actor.exit(statusMessage);
