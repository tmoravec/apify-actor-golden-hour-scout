import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATASET_ITEM_KEYS, DATASET_ITEM_REASONS, DATASET_ITEM_TYPES } from '../src/types.js';

interface DatasetSchema {
    fields: {
        required: string[];
        properties: Record<string, { type?: string | string[]; enum?: string[] }>;
    };
    views: Record<string, { transformation: { fields: string[] }; display: { properties: Record<string, unknown> } }>;
}

function loadSchema(): DatasetSchema {
    const raw = fs.readFileSync(path.join(import.meta.dirname, '..', '.actor', 'dataset_schema.json'), 'utf-8');
    return JSON.parse(raw);
}

describe('.actor/dataset_schema.json', () => {
    it('overview view lists only real DatasetItem/WindowItem fields', () => {
        const schema = loadSchema();
        const { overview } = schema.views;

        for (const field of overview.transformation.fields) {
            expect(DATASET_ITEM_KEYS).toContain(field);
        }
        for (const key of Object.keys(overview.display.properties)) {
            expect(DATASET_ITEM_KEYS).toContain(key);
        }
    });

    it('overview view shows the same fields in the transformation and the display', () => {
        const schema = loadSchema();
        const { overview } = schema.views;

        expect(Object.keys(overview.display.properties)).toEqual(overview.transformation.fields);
    });

    // `fields` documents the item contract in Console and in generated API
    // examples, so it must describe every emitted field and nothing else. Both
    // directions: a field added to types.ts fails here, and so does a schema
    // entry for one that no longer exists.
    it('fields describes exactly the DatasetItem keys', () => {
        const schema = loadSchema();

        expect(Object.keys(schema.fields.properties).sort()).toEqual([...DATASET_ITEM_KEYS].sort());
    });

    // One permissive object describes all three item shapes, so `required` can
    // only name the keys common to them; anything more would reject the
    // polar/noWindows items a high-latitude run legitimately emits.
    it('requires only the keys every item shape carries', () => {
        const schema = loadSchema();

        expect([...schema.fields.required].sort()).toEqual(['date', 'location', 'type']);
    });

    it('type enum matches the discriminator values the code emits', () => {
        const schema = loadSchema();

        expect([...(schema.fields.properties.type.enum ?? [])].sort()).toEqual([...DATASET_ITEM_TYPES].sort());
    });

    it('reason enum matches the reasons the code emits', () => {
        const schema = loadSchema();

        expect([...(schema.fields.properties.reason.enum ?? [])].sort()).toEqual([...DATASET_ITEM_REASONS].sort());
    });

    // Emitted timestamps are ISO-8601 strings carrying an explicit numeric UTC
    // offset, so any JSON type but `string` would misdescribe them.
    it('declares the timestamp fields as strings', () => {
        const schema = loadSchema();

        for (const field of ['date', 'startLocal', 'endLocal']) {
            expect(schema.fields.properties[field].type).toBe('string');
        }
    });

    // Timestamps stay on the `text` renderer: Console's `date` renderer would
    // re-display them in the viewer's zone, which is what the explicit offset in
    // these strings exists to prevent.
    it('renders timestamp columns as text, never as dates', () => {
        const schema = loadSchema();
        const { properties } = schema.views.overview.display;

        for (const field of ['date', 'startLocal', 'endLocal']) {
            expect(properties[field]).toEqual({ label: expect.any(String), format: 'text' });
        }
    });
});
