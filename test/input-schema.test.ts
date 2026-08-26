import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AXES } from '../src/coordinates.js';

interface InputSchema {
    properties: {
        location: { default?: unknown; prefill?: unknown };
        coordinates: {
            sectionCaption?: unknown;
            required?: unknown;
            properties: Record<string, { minimum?: number; maximum?: number }>;
        };
    };
}

function loadSchema(): InputSchema {
    const raw = fs.readFileSync(path.join(import.meta.dirname, '..', '.actor', 'input_schema.json'), 'utf-8');
    return JSON.parse(raw);
}

// Three billing-relevant invariants AGENTS.md states in prose, checked here
// against the schema file: an emptied `location` must never silently geocode a
// prefill, a prefilled `coordinates` pair would outrank an untouched `location`
// on every run, and a `required` array on the nested properties would block
// every plain `location` run, Console sending an untouched section as `{}`.
describe('.actor/input_schema.json', () => {
    it('`location` carries a prefill, never a default', () => {
        const schema = loadSchema();

        expect(schema.properties.location.prefill).toBeDefined();
        expect('default' in schema.properties.location).toBe(false);
    });

    it('`coordinates.latitude`/`longitude` carry neither a default nor a prefill', () => {
        const schema = loadSchema();
        const { properties } = schema.properties.coordinates;

        for (const key of ['latitude', 'longitude']) {
            expect('default' in properties[key]).toBe(false);
            expect('prefill' in properties[key]).toBe(false);
        }
    });

    it('the nested `coordinates` properties carry no `required` array', () => {
        const schema = loadSchema();

        expect('required' in schema.properties.coordinates).toBe(false);
    });

    it('`coordinates` sits behind a `sectionCaption`, so the alternative input has to be unwrapped', () => {
        const schema = loadSchema();

        expect(typeof schema.properties.coordinates.sectionCaption).toBe('string');
    });

    it("the nested minimum/maximum match coordinates.ts's AXES, so the range is stated once", () => {
        const schema = loadSchema();
        const { properties } = schema.properties.coordinates;

        for (const axis of AXES) {
            expect(properties[axis.key].minimum).toBe(axis.min);
            expect(properties[axis.key].maximum).toBe(axis.max);
        }
    });
});
