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

export function normalize(input: string, opts: NormalizeOptions = {}): string {
  let s = input.normalize('NFC');
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
