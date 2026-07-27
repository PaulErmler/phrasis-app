import { describe, it, expect } from 'vitest';

import appEn from '@/messages/en.json';
import appDe from '@/messages/de.json';
import landingEn from '@/messages/landing/en.json';
import landingDe from '@/messages/landing/de.json';

/**
 * Standing parity check between the English and German message catalogs.
 *
 * For each en/de pair it asserts:
 *  1. identical nested key sets (missing keys are reported in both directions),
 *  2. for every shared leaf string, identical ICU placeholder signatures.
 *
 * Placeholder extraction supports exactly the ICU subset these catalogs use
 * (verified by grepping all four files):
 *  - simple arguments:            `{name}`
 *  - plural/select arguments:     `{count, plural, =0 {...} one {...} other {...}}`
 *    compared by argument name, type, and the set of branch keys; branch
 *    bodies are scanned recursively for nested simple arguments (e.g.
 *    `other {Next {count} sentences from {name}}`),
 *  - `#` inside plural branches (the implicit plural value — normalized away).
 *
 * NOT supported (unused here, and the extractor throws on anything it does
 * not recognize rather than silently skipping): `offset:`, selectordinal,
 * number/date/time format arguments, and `''` ICU escaping. Rich-text tags
 * (`<strong>…</strong>`) are plain text to ICU and are not compared.
 *
 * The landing catalogs also contain JSON arrays (`faq.items[].answer[]`);
 * arrays are flattened by numeric index on purpose, so an item/paragraph
 * count mismatch surfaces as an exact missing key like `faq.items.3.answer.1`.
 */

type Catalog = string | Catalog[] | { [key: string]: Catalog };

/** Flattens a nested catalog into dot-separated leaf paths (arrays by index). */
function flattenLeaves(node: Exclude<Catalog, string>, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      leaves.set(path, value);
    } else {
      for (const [childPath, childValue] of flattenLeaves(value, path)) {
        leaves.set(childPath, childValue);
      }
    }
  }
  return leaves;
}

/** Returns the index of the `}` matching the `{` at `openIndex`. */
function findMatchingBrace(message: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < message.length; i++) {
    if (message[i] === '{') depth++;
    else if (message[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`Unbalanced braces in message: ${message}`);
}

/** Splits a plural/select body into its `key {…}` branches. */
function parseBranches(body: string): Array<{ key: string; body: string }> {
  const branches: Array<{ key: string; body: string }> = [];
  let i = 0;
  while (i < body.length) {
    if (/\s/.test(body[i])) {
      i++;
      continue;
    }
    const keyMatch = /^(=\d+|[a-zA-Z0-9_]+)/.exec(body.slice(i));
    if (!keyMatch) {
      throw new Error(`Unsupported plural/select branch syntax: ${body.slice(i)}`);
    }
    i += keyMatch[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== '{') {
      throw new Error(`Expected '{' after branch key "${keyMatch[0]}" in: ${body}`);
    }
    const close = findMatchingBrace(body, i);
    branches.push({ key: keyMatch[0], body: body.slice(i + 1, close) });
    i = close + 1;
  }
  return branches;
}

/**
 * Collects placeholder signatures from a message. Simple arguments become
 * `name`; plural/select become `name:type(sortedBranchKeys)` plus whatever
 * nested arguments their branches contain.
 */
function collectPlaceholders(message: string, out: Set<string>): void {
  let i = 0;
  while (i < message.length) {
    if (message[i] !== '{') {
      i++;
      continue;
    }
    const close = findMatchingBrace(message, i);
    const inner = message.slice(i + 1, close);
    const complex = /^([a-zA-Z0-9_]+)\s*,\s*(plural|select)\s*,([\s\S]*)$/.exec(inner);
    if (complex) {
      const [, name, type, body] = complex;
      const branches = parseBranches(body);
      const branchKeys = branches.map((b) => b.key).sort().join('|');
      out.add(`${name}:${type}(${branchKeys})`);
      for (const branch of branches) collectPlaceholders(branch.body, out);
    } else if (/^[a-zA-Z0-9_]+$/.test(inner)) {
      out.add(inner);
    } else {
      // Anything else means the extractor's supported subset is out of date —
      // fail loudly instead of silently under-checking.
      throw new Error(`Unsupported ICU syntax "{${inner}}" in message: ${message}`);
    }
    i = close + 1;
  }
}

function placeholderSignature(message: string): string[] {
  const out = new Set<string>();
  collectPlaceholders(message, out);
  return [...out].sort();
}

const pairs = [
  {
    name: 'app catalogs (messages/{en,de}.json)',
    en: appEn as Exclude<Catalog, string>,
    de: appDe as Exclude<Catalog, string>,
  },
  {
    name: 'landing catalogs (messages/landing/{en,de}.json)',
    en: landingEn as Exclude<Catalog, string>,
    de: landingDe as Exclude<Catalog, string>,
  },
];

describe('catalog flattening (self-check)', () => {
  it('flattens nested objects and arrays into indexed leaf paths', () => {
    expect(flattenLeaves({ faq: { items: [{ answer: ['a', 'b'] }] } })).toEqual(
      new Map([
        ['faq.items.0.answer.0', 'a'],
        ['faq.items.0.answer.1', 'b'],
      ]),
    );
  });
});

describe('placeholder extraction (self-check)', () => {
  it('extracts simple arguments', () => {
    expect(placeholderSignature('Welcome back, {viewer}!')).toEqual(['viewer']);
  });

  it('extracts plural argument names, branch keys, and nested arguments', () => {
    expect(
      placeholderSignature(
        '{count, plural, one {Next sentence from {name}} other {Next {count} sentences from {name}}}',
      ),
    ).toEqual(['count', 'count:plural(one|other)', 'name']);
  });

  it('normalizes # and treats =N branches as part of the signature', () => {
    expect(placeholderSignature('{count, plural, =0 {none} one {# word} other {# words}}')).toEqual([
      'count:plural(=0|one|other)',
    ]);
  });

  it('throws on ICU syntax outside the supported subset', () => {
    expect(() => placeholderSignature('{count, number}')).toThrow(/Unsupported ICU syntax/);
  });
});

describe.each(pairs)('$name', ({ en, de }) => {
  const enLeaves = flattenLeaves(en);
  const deLeaves = flattenLeaves(de);

  it('has identical nested key sets', () => {
    const missingInDe = [...enLeaves.keys()].filter((key) => !deLeaves.has(key));
    const missingInEn = [...deLeaves.keys()].filter((key) => !enLeaves.has(key));
    expect({ missingInDe, missingInEn }).toEqual({ missingInDe: [], missingInEn: [] });
  });

  it('has identical ICU placeholder sets for every shared leaf', () => {
    const mismatches: Array<{ key: string; en: string[]; de: string[] }> = [];
    for (const [key, enMessage] of enLeaves) {
      const deMessage = deLeaves.get(key);
      if (deMessage === undefined) continue; // covered by the key-set test
      const enPlaceholders = placeholderSignature(enMessage);
      const dePlaceholders = placeholderSignature(deMessage);
      if (enPlaceholders.join(',') !== dePlaceholders.join(',')) {
        mismatches.push({ key, en: enPlaceholders, de: dePlaceholders });
      }
    }
    expect(mismatches).toEqual([]);
  });
});
