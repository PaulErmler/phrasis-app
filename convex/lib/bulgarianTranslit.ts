/**
 * Bulgarian Cyrillic → Latin in the Streamlined System, the romanization made
 * mandatory by the 2009 Transliteration Act (Закон за транслитерацията) and
 * adopted by the UN in 2012 and BGN/PCGN in 2013. It's what appears on
 * Bulgarian passports and road signs, so it's the spelling a learner will
 * actually meet in the country.
 *
 * VENDORED from translitbg.js v2.0.0 by Petar Petrov (MIT),
 * https://github.com/petarov/translitbg.js — ported to TypeScript with two
 * changes, both noted inline:
 *
 *  1. The upstream word-boundary test for the `-ия` rule is `/^\w+$/`, and
 *     `\w` in JavaScript is ASCII-only. Every Cyrillic letter therefore
 *     failed it, so upstream treats *any* `ия` as word-final: `приятел` →
 *     "priatel", `Марията` → "Mariata", `сияние` → "sianie". Fixed with a
 *     Unicode letter test. Upstream is unmaintained (last release 2024-05)
 *     and the check lives inside a non-exported closure, so this could not
 *     be patched from outside the package.
 *  2. Art. 6 (`България` → "Bulgaria") was not implemented upstream; it
 *     produced the by-the-table "Balgaria".
 *
 * Not a general Cyrillic romanizer: Russian/Ukrainian/Serbian have their own
 * systems and stay on Google v3 (see convex/features/translation.ts).
 */

/**
 * Art. 4 — the letter table. `ъ` → "a" and `ь` → "y" are the Act's own
 * choices; they merge distinctions a learner can hear (`ъ` is /ɤ/, not /a/),
 * but deviating would stop this being the official system, and the IPA line
 * carries the phonetics for anyone who turns it on.
 */
const LOWER: Record<string, string> = {
  'а': 'a',
  'б': 'b',
  'в': 'v',
  'г': 'g',
  'д': 'd',
  'е': 'e',
  'ж': 'zh',
  'з': 'z',
  'и': 'i',
  'ѝ': 'i',
  'й': 'y',
  'к': 'k',
  'л': 'l',
  'м': 'm',
  'н': 'n',
  'о': 'o',
  'п': 'p',
  'р': 'r',
  'с': 's',
  'т': 't',
  'у': 'u',
  'ф': 'f',
  'х': 'h',
  'ц': 'ts',
  'ч': 'ch',
  'ш': 'sh',
  'щ': 'sht',
  'ъ': 'a',
  'ь': 'y',
  'ю': 'yu',
  'я': 'ya',
};

/** Title-case forms, e.g. Ж → "Zh". Used when the run is not all-caps. */
const UPPER: Record<string, string> = Object.fromEntries(
  Object.entries(LOWER).map(([cyr, lat]) => [
    cyr.toUpperCase(),
    lat.charAt(0).toUpperCase() + lat.slice(1),
  ]),
);

/**
 * All-caps forms of the multi-letter mappings. "ЖИВОТ" is ZHIVOT, not
 * "ZhIVOT": inside an all-caps run the whole digraph capitalises.
 */
const UPPER_RUN: Record<string, string> = Object.fromEntries(
  Object.entries(LOWER)
    .filter(([, lat]) => lat.length > 1)
    .map(([cyr, lat]) => [cyr.toUpperCase(), lat.toUpperCase()]),
);

/** Art. 5(2) — the combination `ия` at the end of a word is written `ia`. */
const IA_TOKEN: Record<string, string> = {
  'ия': 'ia',
  'Ия': 'Ia',
  'иЯ': 'iA',
  'ИЯ': 'IA',
};

/**
 * Art. 6 — the state's name keeps its traditional English spelling rather
 * than the by-the-table "Balgaria".
 */
const NAMED_EXCEPTIONS: Record<string, string> = {
  'България': 'Bulgaria',
  'БЪЛГАРИЯ': 'BULGARIA',
  'българия': 'bulgaria',
};

/**
 * Any Unicode letter or digit. Replaces upstream's `/^\w+$/`, which is
 * ASCII-only and so never matched the Cyrillic letter that follows a
 * mid-word `ия`.
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Word-boundary-aware so Art. 6 can match whole words only: `България` is
 * replaced, but a longer word merely containing it is left to the table.
 */
const NAMED_EXCEPTION_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${Object.keys(NAMED_EXCEPTIONS).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

/**
 * `true` when `ch` participates in the all-caps rule: an uppercase Cyrillic
 * letter we map, or a non-letter (so "ЩАСТИЕ!" and "ЩАСТИЕ" agree).
 */
function continuesUpperRun(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  if (UPPER[ch] !== undefined) return true;
  return !WORD_CHAR.test(ch);
}

function transliterateRun(text: string): string {
  const chars = [...text];
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const mapped = LOWER[ch] ?? UPPER[ch];
    if (mapped === undefined) {
      out += ch;
      continue;
    }

    // Art. 5(2): `ия` only collapses to `ia` at a true word end.
    const next = chars[i + 1];
    if (next !== undefined) {
      const token = IA_TOKEN[ch + next];
      if (token !== undefined) {
        const after = chars[i + 2];
        if (after === undefined || !WORD_CHAR.test(after)) {
          out += token;
          i++;
          continue;
        }
      }
    }

    // All-caps run: capitalise the whole digraph rather than title-casing it.
    const upperRun = UPPER_RUN[ch];
    if (upperRun !== undefined) {
      const prev = chars[i - 1];
      if (continuesUpperRun(next) && continuesUpperRun(prev)) {
        out += upperRun;
        continue;
      }
    }

    out += mapped;
  }

  return out;
}

/**
 * Romanize Bulgarian text. Latin runs, digits and punctuation pass through
 * unchanged; anything outside the Bulgarian alphabet is left as-is.
 */
export function transliterateBulgarian(text: string): string {
  // Art. 6 first, so the named exception isn't re-processed by the table.
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(NAMED_EXCEPTION_PATTERN)) {
    parts.push(transliterateRun(text.slice(last, match.index)));
    parts.push(NAMED_EXCEPTIONS[match[0]]!);
    last = match.index + match[0].length;
  }
  parts.push(transliterateRun(text.slice(last)));
  return parts.join('');
}
