import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  APP_NAMESPACES,
  LANDING_NAMESPACES,
  ONBOARDING_NAMESPACES,
  SHARED_NAMESPACES,
} from '@/i18n/namespaces';
import enMessages from '@/messages/en.json';
import deMessages from '@/messages/de.json';

/**
 * Guards the per-route i18n payload split (i18n/namespaces.ts): every
 * namespace a CLIENT component consumes must be shipped by the provider of
 * the route area the file belongs to. Without this, a moved/added
 * useTranslations() call silently renders «fallback» strings in production.
 *
 * Server-side getTranslations() reads the request config (full dictionary)
 * and needs no registration.
 *
 * Known limitation: files are mapped to areas by path, not by import graph —
 * a generic component newly imported by the landing page won't be caught
 * here (the dev-mode onError throw in ScopedIntlProvider covers that case).
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib'];
const USE_TRANSLATIONS_RE = /useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g;

const SHARED = new Set<string>(SHARED_NAMESPACES);
const APP = new Set<string>([...SHARED_NAMESPACES, ...APP_NAMESPACES]);
const ONBOARDING = new Set<string>([
  ...SHARED_NAMESPACES,
  ...APP_NAMESPACES,
  ...ONBOARDING_NAMESPACES,
]);
const LANDING = new Set<string>([
  ...SHARED_NAMESPACES,
  ...LANDING_NAMESPACES,
]);

function areaFor(rel: string): { name: string; allowed: Set<string> } {
  if (rel.startsWith('components/landing') || rel === 'app/page.tsx') {
    return { name: 'landing', allowed: LANDING };
  }
  if (rel.startsWith('app/app/onboarding')) {
    return { name: 'onboarding', allowed: ONBOARDING };
  }
  if (
    rel.startsWith('app/app') ||
    rel.startsWith('components/') ||
    rel.startsWith('hooks/') ||
    rel.startsWith('lib/')
  ) {
    return { name: 'app', allowed: APP };
  }
  // Root-level surfaces (auth pages, legal, not-found, consent) only get the
  // shared set.
  return { name: 'root', allowed: SHARED };
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === '.next' ||
      entry === '.git' ||
      entry === 'worktrees'
    ) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

describe('i18n namespace coverage', () => {
  it('registered namespaces exist in both locale files', () => {
    const all = [
      ...SHARED_NAMESPACES,
      ...APP_NAMESPACES,
      ...ONBOARDING_NAMESPACES,
      ...LANDING_NAMESPACES,
    ];
    // Auth and LandingPage are merged in from separate files by
    // i18n/request.tsx, so they're absent from messages/{en,de}.json.
    const mergedElsewhere = new Set(['Auth', 'LandingPage']);
    for (const ns of all) {
      if (mergedElsewhere.has(ns)) continue;
      expect(enMessages, `"${ns}" missing from messages/en.json`).toHaveProperty(ns);
      expect(deMessages, `"${ns}" missing from messages/de.json`).toHaveProperty(ns);
    }
  });

  it('every client-consumed namespace is shipped by its route area', () => {
    const violations: string[] = [];

    for (const dir of SOURCE_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const src = readFileSync(file, 'utf8');
        const namespaces = new Set(
          [...src.matchAll(USE_TRANSLATIONS_RE)].map(
            (m) => m[1].split('.')[0],
          ),
        );
        if (namespaces.size === 0) continue;

        const area = areaFor(rel);
        for (const ns of namespaces) {
          if (!area.allowed.has(ns)) {
            violations.push(
              `${rel} uses "${ns}" but the ${area.name} provider doesn't ship it`,
            );
          }
        }
      }
    }

    expect(
      violations,
      `Unshipped namespaces found — register them in i18n/namespaces.ts:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
