export interface NormalizeOptions {
  foldCase?: boolean;
  foldDiacritics?: boolean;
  collapseWhitespace?: boolean;
  /** Drop punctuation so it can't affect the accuracy score. Opt-in setting. */
  ignorePunctuation?: boolean;
}

/** Every Unicode punctuation category. ASCII marks, the CJK block
 * (。、「」 at U+3000–303F), full-width ！？, and the Spanish inverted ¿¡.
 * Deliberately not `\p{S}`, which would also eat currency and math symbols. */
export const PUNCTUATION_RE = /\p{P}/gu;

/** True when `text` is nothing but punctuation. Whitespace does not count:
 * interior spaces survive normalization's run-collapse and still cost
 * accuracy (real for Thai, the char-path language with spaces), so a
 * whitespace-bearing chunk is never score-neutral. */
export function isPunctuationOnly(text: string): boolean {
  return text.length > 0 && text.replace(PUNCTUATION_RE, '') === '';
}

/**
 * Apostrophe-like characters folded onto ASCII `'` before comparing: the
 * curly single quotes LLM output favours, the grave/acute accents some
 * keyboards produce, and the modifier letters Uzbek Latin spells oʻ / gʻ /
 * taʼkid with (`canonicalizeUzbekApostrophes` in lib/languages.ts stores
 * those; learners can only type `'`). Folding also makes the two modifier
 * letters count as punctuation, which they are for scoring purposes: they
 * are Unicode letters (`Lm`), so `ignorePunctuation` would otherwise keep
 * them and `o'zbek` vs `oʻzbek` could never match.
 */
const APOSTROPHE_LIKE_RE = /[‘’ʻʼʽ`´]/gu;

export function foldApostrophes(text: string): string {
  return text.replace(APOSTROPHE_LIKE_RE, "'");
}

export function normalize(input: string, opts: NormalizeOptions = {}): string {
  let s = foldApostrophes(input.normalize('NFC'));
  if (opts.ignorePunctuation) {
    // Before whitespace collapsing, so " word . " leaves no double space
    // behind and " ! " doesn't survive as a stray token.
    s = s.replace(PUNCTUATION_RE, '');
  }
  if (opts.collapseWhitespace !== false) {
    s = s.replace(/\s+/g, ' ').trim();
  }
  if (opts.foldCase) {
    s = s.toLocaleLowerCase();
  }
  if (opts.foldDiacritics) {
    s = s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  }
  return s;
}

/**
 * Strip punctuation AND symbols, collapse whitespace, lowercase — the
 * server's equality normalizer for "is this the same answer/transcript?"
 * (TTS validation, the writing grader's free local gate). Stricter than
 * `normalize` above (which is tuned for accuracy scoring): `\p{S}` is
 * stripped too, and case always folds.
 *
 * Lives here (pure, dependency-free) because both runtimes need the SAME
 * function: convex/lib/textComparison.ts re-exports it for the server, and
 * the client's local writing gate (bestMatch.ts) mirrors the server gate
 * with it. One implementation so the two gates can't drift.
 */
export function normalizeForComparison(text: string): string {
  return foldApostrophes(text.normalize('NFC'))
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
