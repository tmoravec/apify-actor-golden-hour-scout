import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPORT_KEY } from '../src/output.js';

interface OutputSchema {
    properties: { report: { template: string } };
}

function loadSchema(): OutputSchema {
    const raw = fs.readFileSync(path.join(import.meta.dirname, '..', '.actor', 'output_schema.json'), 'utf-8');
    return JSON.parse(raw);
}

// Console reads this file to render the Output-tab preview, resolving the
// template server-side against the run's key-value store, so a drift here shows
// up as an empty preview with nothing failing anywhere else.
describe('.actor/output_schema.json', () => {
    it("report.template ends with output.ts's REPORT_KEY, not a second literal spelling of the key", () => {
        const schema = loadSchema();

        expect(schema.properties.report.template.endsWith(`/records/${REPORT_KEY}`)).toBe(true);
    });
});
