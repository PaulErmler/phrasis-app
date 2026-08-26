/**
 * Synchronous, in-process romanization for languages whose script we can
 * convert to Latin without a network call. Used both by `romanizeText`
 * (to avoid round-tripping to Google) and by TTS validation (so strict
 * hanzi/hangul/Greek comparisons can tolerate homophone swaps and
 * diacritic drift introduced by Scribe).
 *
 * Returns `null` for languages that require Google Cloud romanization.
 */

import { romanize as romanizeHangul } from 'es-hangul';
// @ts-expect-error no type declarations for chinese-to-pinyin
import pinyin from 'chinese-to-pinyin';
// Traditional→simplified only (the `t2cn` subpath is ~104 KB; the full build
// is ~1.1 MB and carries the simplified→traditional tables we never use).
import * as OpenCC from 'opencc-js/t2cn';
// @ts-expect-error no type declarations for greek-utils
import greekUtils from 'greek-utils';
import { transliterate as transliterateHebrew } from 'hebrew-transliteration';
import { getJyutpingList } from 'to-jyutping';
// @ts-expect-error no type declarations for arabic-transliterate (pure JS, ~74KB, zero deps)
import arabictransliterate from 'arabic-transliterate';
import transliterate from '@sindresorhus/transliterate';
import Sanscript from '@indic-transliteration/sanscript';
import { transliterateBulgarian } from './bulgarianTranslit';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';

/**
 * Languages we can romanize locally without a network call. Derived from each
 * Language's `romanizationBackend === 'local'` flag (single source of truth in
 * lib/languages.ts); languages on `'google-v3'` (ru/hi/bn/ja/ta) are excluded.
 *
 * Arabic was moved here off the Google v3 path after a regression where the
 * romanizeText endpoint started returning `{"romanizations":[{}]}` for short
 * Arabic strings (200 OK, empty entry, the Vyshantha/arabic-transliterate
 * library produces a deterministic IJMES romanization with zero deps, fine
 * for the Convex V8 runtime). Telugu followed after the same endpoint 400d
 * "Source language is unsupported" for `te`, and now goes through sanscript's
 * ISO 15919 scheme. Bulgarian was never on Google's romanize list at all; it
 * was catalogued as google-v3 by mistake, and runs on the vendored
 * Streamlined-System mapper in ./bulgarianTranslit.
 */
export const LOCAL_ROMANIZATION_LANGUAGES = new Set(
  SUPPORTED_LANGUAGES.filter((l) => l.romanizationBackend === 'local').map(
    (l) => l.code,
  ),
);

export function hasLocalRomanization(code: string): boolean {
  return LOCAL_ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Stable identifiers for each romanization backend. Persisted on rows
 * alongside `romanizedText` so a future strategy swap can find rows
 * produced by the old method (`romanizationSource != currentSource`) and
 * regenerate them. Bump the `-v<n>` suffix when changing the library OR
 * its configuration in a way that should invalidate existing rows.
 */
export const ROMANIZATION_SOURCES = {
  // v2: segment-based (punctuation/Latin/digits preserved) + traditional→
  // simplified pre-conversion so the segmenter resolves polyphones.
  chineseToPinyin: 'chinese-to-pinyin-v2',
  greekUtils: 'greek-utils-v1',
  esHangul: 'es-hangul-v1',
  hebrewTransliteration: 'hebrew-transliteration-v1',
  toJyutping: 'to-jyutping-v1',
  arabicTransliterate: 'arabic-transliterate-v1',
  sindresorhusTransliterate: 'sindresorhus-transliterate-v1',
  sanscriptIso15919: 'sanscript-iso15919-v1',
  // v2: the 2009 Act's exception rules (word-final -ия → -ia, България →
  // Bulgaria) and all-caps digraphs, none of which v1's letter walk applied.
  bulgarianStreamlined: 'bulgarian-streamlined-v2',
  googleV3: 'google-v3-v1',
} as const;

export type RomanizationSource =
  (typeof ROMANIZATION_SOURCES)[keyof typeof ROMANIZATION_SOURCES];

/**
 * Resolve the source identifier we'll use (or just used) for a language.
 * Mirrors the routing in `romanizeLocal` + `romanizeText` so callers can
 * record the source alongside the result without coupling to the function
 * internals.
 */
export function getRomanizationSource(language: string): RomanizationSource {
  if (language === 'zh' || language === 'zh_traditional') {
    return ROMANIZATION_SOURCES.chineseToPinyin;
  }
  if (language === 'el') return ROMANIZATION_SOURCES.greekUtils;
  if (language === 'ko') return ROMANIZATION_SOURCES.esHangul;
  if (language === 'he') return ROMANIZATION_SOURCES.hebrewTransliteration;
  if (language === 'yue' || language === 'yue_traditional') {
    return ROMANIZATION_SOURCES.toJyutping;
  }
  if (
    language === 'ar' ||
    language === 'ar_sa' ||
    language === 'ar_eg' ||
    language === 'ar_iq' ||
    language === 'ar_lev'
  ) {
    return ROMANIZATION_SOURCES.arabicTransliterate;
  }
  if (language === 'fa') return ROMANIZATION_SOURCES.sindresorhusTransliterate;
  if (language === 'te') return ROMANIZATION_SOURCES.sanscriptIso15919;
  if (language === 'bg') return ROMANIZATION_SOURCES.bulgarianStreamlined;
  // Everything else in ROMANIZATION_LANGUAGES (ru, hi, ja, bn, ta, uk, sr)
  // routes through Google v3. See `romanizeText` in convex/features/translation.ts.
  return ROMANIZATION_SOURCES.googleV3;
}

/**
 * Subset of local-romanization languages where romanizing BEFORE strict
 * TTS comparison is worthwhile. Chinese (Simplified + Traditional) and Korean
 * benefit because Scribe often returns a homophone character with
 * identical/near-identical romanization; Greek is excluded because the
 * hanzi/hangul ambiguity doesn't apply. Greek orthography is already closely
 * phonetic.
 */
export const TTS_ROMANIZATION_LANGUAGES = new Set([
  'zh', 'zh_traditional', 'ko',
]);

export function shouldRomanizeForTtsMatch(code: string): boolean {
  return TTS_ROMANIZATION_LANGUAGES.has(code);
}

/**
 * Romanize `text` in `language` using a local library.
 * Returns `null` when the language has no local romanizer. The caller must
 * fall back to a remote romanization API.
 */
export function romanizeLocal(text: string, language: string): string | null {
  if (language === 'zh' || language === 'zh_traditional') {
    return romanizeChinese(text, language === 'zh_traditional');
  }
  if (language === 'el') return greekUtils.toPhoneticLatin(text);
  if (language === 'ko') return romanizeHangul(text);
  if (language === 'he') return transliterateHebrew(text);
  if (language === 'yue' || language === 'yue_traditional') {
    return romanizeCantonese(text);
  }
  if (
    language === 'ar' ||
    language === 'ar_sa' ||
    language === 'ar_eg' ||
    language === 'ar_iq' ||
    language === 'ar_lev'
  ) {
    // IJMES Arabic→Latin transliteration. The library treats all dialects as
    // the same script (it operates on the Arabic Unicode block), so the
    // dialect tail of the code is irrelevant here. Pass language='Arabic'
    // (the library's switch key, NOT the BCP-47 tag).
    return arabictransliterate(text, 'arabic2latin', 'Arabic') as string;
  }
  if (language === 'fa') {
    // Persian (Perso-Arabic script). `@sindresorhus/transliterate` maps the
    // written consonants + long vowels and the Persian-specific letters
    // (پ/چ/ژ/گ) to Latin; short vowels aren't written in the script so they
    // don't appear. The library passes a few combining marks through unchanged,
    // so strip them post-transliteration or they leak as invisible/garbled
    // chars: U+200C zero-width non-joiner (between word parts), U+0654 hamza
    // above (the ezafe hamza on -e/-eh words, very common), and U+0670
    // superscript alef.
    // Alternation (not a character class) avoids no-misleading-character-class,
    // which flags combining marks like U+0654/U+0670 inside `[...]`.
    return transliterate(text).replace(/\u200C|\u0654|\u0670/g, '');
  }
  if (language === 'te') return romanizeTelugu(text);
  if (language === 'bg') return transliterateBulgarian(text);
  return null;
}

/**
 * Traditional→simplified converter, built ONCE on first use: `OpenCC.Converter`
 * compiles a lookup trie, far too expensive to rebuild per sentence, but also
 * too expensive to build at import time, since every Convex isolate importing
 * this module (translations, migrations, TTS matching) would pay it on cold
 * start whether or not it ever romanizes zh_traditional.
 */
let t2cn: ((text: string) => string) | undefined;
const traditionalToSimplified = (text: string): string =>
  (t2cn ??= OpenCC.Converter({ from: 'tw', to: 'cn' }))(text);

/** Runs of Han characters. The only spans `chinese-to-pinyin` should see. */
const HAN_RUN = /\p{Script=Han}+/gu;

/**
 * Join romanized segments with spaces, then re-attach punctuation (ASCII and
 * fullwidth) to the preceding syllable and collapse the leftover whitespace.
 * Shared tail of `romanizeChinese` and `romanizeCantonese`.
 */
function joinRomanizedSegments(segments: string[]): string {
  return segments
    .join(' ')
    .replace(/\s+([,.!?;:、，。！？；：])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert a Chinese string to pinyin (tone diacritics).
 *
 * Two things the bare `pinyin(text)` call got wrong:
 *
 * 1. It DELETED everything non-Han. The library defaults to `keepRest: false`,
 *    so punctuation, Latin words and digits silently vanished ("我有2个苹果。"
 *    → "wǒ yǒu gè píng guǒ"). We romanize each Han run separately and pass the
 *    gaps through verbatim instead: `keepRest: true` would keep them but glue
 *    them onto the neighbouring syllable ("wǒ yǒu2gè"). Splitting on non-Han
 *    boundaries never splits a word, so segmentation quality is unaffected.
 *
 * 2. Traditional script got context-blind readings. The library's
 *    word-segmentation dictionary is simplified-oriented, so traditional text
 *    fell back to per-character lookup and produced the wrong reading for
 *    polyphones (銀行 → "yín xíng", 音樂 → "yīn lè", 睡覺 → "shuì jué").
 *    Converting to simplified first hands the segmenter a dictionary it can
 *    match; pinyin is script-independent, so the output is identical for text
 *    that was already unambiguous. Known residual: 很長 still reads "zhǎng"
 *    rather than "cháng": that one fails on simplified too, i.e. a library
 *    limit rather than a script problem.
 *
 * Mirrors `romanizeCantonese`'s buffer-and-join shape below.
 */
function romanizeChinese(text: string, traditional: boolean): string {
  const source = traditional ? traditionalToSimplified(text) : text;

  const segments: string[] = [];
  let lastIndex = 0;
  // `matchAll` over a fresh iterator. HAN_RUN carries /g, so never rely on
  // its mutable lastIndex across calls.
  for (const match of source.matchAll(HAN_RUN)) {
    const start = match.index;
    // Gap since the previous Han run (punctuation, Latin, digits), verbatim.
    if (start > lastIndex) segments.push(source.slice(lastIndex, start));
    segments.push(pinyin(match[0]) as string);
    lastIndex = start + match[0].length;
  }
  if (lastIndex < source.length) segments.push(source.slice(lastIndex));

  return joinRomanizedSegments(segments);
}

/**
 * Convert a Cantonese string to LSHK / Jyutping notation via `to-jyutping`
 * (rime-cantonese data with word-level segmentation, so polyphonic characters
 * get their in-context reading. 食 → sik6, 可以 → ho2 ji5, and vernacular
 * particles like 嘅/㗎/哋/嘢/咗 all resolve; both traditional AND simplified
 * script are covered). We use `getJyutpingList`. One `[char, reading|null]`
 * pair per codepoint, instead of `getJyutpingText`, because the latter
 * collapses non-Han runs (Latin, digits) into a literal "[…]".
 *
 * Characters with a `null` reading (punctuation, spaces, Latin, digits) pass
 * through unchanged, and consecutive ones are coalesced into a single segment
 * so Latin runs keep their internal spacing (e.g. "你好abc 123" →
 * "nei5 hou2 abc 123", not "nei5 hou2 a b c 1 2 3").
 */
function romanizeCantonese(text: string): string {
  const pairs = getJyutpingList(text);

  const segments: string[] = [];
  let buffer = '';
  for (const [char, reading] of pairs) {
    if (reading !== null && reading.length > 0) {
      // Flush any pending non-Han run before emitting the Jyutping syllable.
      if (buffer.length > 0) {
        segments.push(buffer);
        buffer = '';
      }
      segments.push(reading);
    } else {
      // No Jyutping for this codepoint; buffer it so adjacent non-Han
      // codepoints stay glued together.
      buffer += char;
    }
  }
  if (buffer.length > 0) segments.push(buffer);

  return joinRomanizedSegments(segments);
}

/**
 * Telugu → ISO 15919 via `@indic-transliteration/sanscript` (its `iso`
 * scheme). Google v3 romanizeText 400s on `te`, and
 * `@sindresorhus/transliterate` leaves Telugu codepoints untouched.
 *
 * ISO 15919 rather than IAST because Telugu contrasts short and long e/o and
 * IAST cannot write that contrast: it renders నేను and a short-e word alike
 * as "nenu", and falls back to a grave accent for short e ("tèlugu"). The
 * ASCII schemes (ITRANS, Harvard-Kyoto) encode length as capitals — "nEnu",
 * "namaskAraM" — which reads as shouting mid-sentence. ISO also keeps ఌ and
 * ళ apart (l̥ vs ḷ), where IAST collapses both onto ḷ.
 */

/**
 * The three Telugu-specific letters sanscript has no mapping for; left alone
 * they would survive the ISO pass as raw Telugu codepoints in a line that is
 * supposed to be Latin. Rewritten to their modern equivalents first, which
 * take vowel signs and viramas identically (a private-use sentinel does not:
 * the following vowel sign loses its consonant, so "ౘు" comes back as "u").
 *
 * ౘ/ౙ are archaic spellings of the /ts/ and /dz/ that modern Telugu writes
 * with చ/జ, so this folds that distinction away — an acceptable trade for
 * letters deprecated in current orthography. ౚ is a true alias for ఱ.
 */
const TELUGU_ARCHAIC_LETTERS: Array<[RegExp, string]> = [
  [/ౘ/g, 'చ'],
  [/ౙ/g, 'జ'],
  [/ౚ/g, 'ఱ'],
];

function romanizeTelugu(text: string): string {
  const modernized = TELUGU_ARCHAIC_LETTERS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
  return Sanscript.t(modernized, 'telugu', 'iso');
}
