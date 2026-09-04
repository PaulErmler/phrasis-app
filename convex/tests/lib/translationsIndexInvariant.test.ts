/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Superseded translation revisions are rows of `translations` (see
 * `supersededAt` in schema.ts). Every read of a (text, language) pair must
 * therefore decide whether it wants the live row, the superseded ones, or
 * all of them, and that decision lives in ONE module:
 * convex/db/translationReads.ts (`liveTranslation`, `translationRevisions`,
 * `liveTranslationsForText`, `resolveServedFromLive`). A raw
 * `.withIndex('by_text_language_supersededAt'` (or the per-text
 * `by_textId_supersededAt`) anywhere else would happen to return the live
 * row first (Convex orders `undefined` before every value), which is exactly
 * the accident that turns into a bug the day someone adds `.order('desc')`
 * or `.collect()`.
 */

const CONVEX_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const THIS_FILE = relative(CONVEX_ROOT, fileURLToPath(import.meta.url))
  .split('\\')
  .join('/');
const ALLOWED = new Set(['schema.ts', 'db/translationReads.ts', THIS_FILE]);
const INDEX_LITERALS = [
  "'by_text_language_supersededAt'",
  "'by_textId_supersededAt'",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '_generated' || entry === 'node_modules') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function sources(): Array<{ rel: string; src: string }> {
  return walk(CONVEX_ROOT)
    .map((file) => relative(CONVEX_ROOT, file).split('\\').join('/'))
    .filter((rel) => !ALLOWED.has(rel))
    .map((rel) => ({ rel, src: readFileSync(join(CONVEX_ROOT, rel), 'utf8') }));
}

describe('translations index invariant', () => {
  it('only schema.ts and db/translationReads.ts name the indexes', () => {
    const offenders = sources()
      .filter(({ src }) => INDEX_LITERALS.some((lit) => src.includes(lit)))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('nothing queries translations through the legacy two-column index', () => {
    // `by_text_and_language` still exists on `translations` (schema.ts says
    // why); the same name is a legitimate `audioRecordings` index, so the
    // check is on the table + index pair.
    const legacy =
      /\.query\(\s*'translations'\s*\)\s*\.withIndex\(\s*'by_text_and_language'/;
    const offenders = sources()
      .filter(({ src }) => legacy.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
