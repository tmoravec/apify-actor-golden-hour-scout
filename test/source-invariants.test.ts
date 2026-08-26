import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards two AGENTS.md invariants nothing else can catch -- `src/main.ts`'s "no
 * declarations" shape and the single wall-clock `new Date()` -- and is expected
 * to be edited only when those invariants themselves change.
 *
 * Comments are stripped first (string and template contents kept), since the very
 * prose documenting these invariants mentions the keywords being searched for. A
 * lightweight string-aware stripper, not a parser: verified against every file in
 * `src/`, `escape.ts`'s quote-only regex literals included, which a naive one
 * would read as unterminated strings.
 */
function stripComments(source: string): string {
    return source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*|\/\*[\s\S]*?\*\//g, (match) =>
        match.startsWith('//') || match.startsWith('/*') ? '' : match,
    );
}

function listSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(full);
        return entry.name.endsWith('.ts') ? [full] : [];
    });
}

const SRC_DIR = path.join(import.meta.dirname, '..', 'src');
const MAIN_TS = path.join(SRC_DIR, 'main.ts');

describe('source invariants', () => {
    // Branch keywords cost the same one-line check as the declaration ones, so
    // they are asserted too. Ternaries and template-literal string building are
    // uncatchable this way and stay prose-enforced in AGENTS.md.
    it.each([
        ['function', /\bfunction\b/],
        ['arrow function', /=>/],
        ['class', /\bclass\b/],
        ['try', /\btry\b/],
        ['catch', /\bcatch\b/],
        ['if', /\bif\b/],
        ['else', /\belse\b/],
        ['for', /\bfor\b/],
        ['while', /\bwhile\b/],
        ['switch', /\bswitch\b/],
    ])('src/main.ts contains no `%s` (AGENTS.md: "main.ts is wiring only")', (_label, pattern) => {
        const stripped = stripComments(fs.readFileSync(MAIN_TS, 'utf-8'));

        expect(stripped).not.toMatch(pattern);
    });

    it('exactly one bare `new Date()` exists in src/, and it is in main.ts (AGENTS.md: "wall clock")', () => {
        const files = listSourceFiles(SRC_DIR);
        const occurrences = files.flatMap((file) => {
            const stripped = stripComments(fs.readFileSync(file, 'utf-8'));
            // Whitespace-tolerant, so `new Date( )` cannot slip past a bare-parens check.
            const matches = stripped.match(/\bnew\s+Date\s*\(\s*\)/g) ?? [];
            return matches.map(() => file);
        });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]).toBe(MAIN_TS);
    });

    it('`Date.now()` never appears in src/ (AGENTS.md: "wall clock" forbids both in the same sentence)', () => {
        const files = listSourceFiles(SRC_DIR);
        const occurrences = files.flatMap((file) => {
            const stripped = stripComments(fs.readFileSync(file, 'utf-8'));
            const matches = stripped.match(/\bDate\.now\(\)/g) ?? [];
            return matches.map(() => file);
        });

        expect(occurrences).toHaveLength(0);
    });
});
