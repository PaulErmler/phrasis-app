import {
  SUPPORTED_LANGUAGES,
  getLocalizedLanguageNameByCode,
} from '@/lib/languages';

function normalize(s: string): string {
  // NFD strips accents, then we drop combining marks; also lowercases and trims.
  // Keep Unicode letters/numbers so non-Latin scripts (e.g. 日本語) survive.
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function candidatesForCode(code: string, locale: string): string[] {
  const out: string[] = [code];
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  if (lang) {
    out.push(lang.name, lang.nativeName);
    // "Spanish (Spain)" → also match the prefix "Spanish"
    const paren = lang.name.replace(/\s*\(.*\)\s*$/, '');
    if (paren !== lang.name) out.push(paren);
  }
  // Localized form via Intl.DisplayNames
  try {
    out.push(getLocalizedLanguageNameByCode(code, locale));
    out.push(getLocalizedLanguageNameByCode(code, 'en'));
  } catch {
    /* ignore */
  }
  return out.map(normalize).filter((s) => s.length > 0);
}

/**
 * Returns true if the header cell plausibly names the given language code.
 * Matches English name, native name, locale-resolved name, and the ISO code.
 * Accent- and case-insensitive.
 */
export function cellMatchesLanguage(
  cell: string,
  code: string,
  locale: string,
): boolean {
  const needle = normalize(cell);
  if (needle.length === 0) return false;
  const candidates = candidatesForCode(code, locale);
  return candidates.some(
    (c) => c === needle || needle.startsWith(c) || c.startsWith(needle),
  );
}

/**
 * Best-effort heuristic for "is the first row a header?".
 * Positive signals: short cells, no sentence punctuation, at least one cell
 * that matches a known language name, or all cells uniformly header-ish.
 */
export function detectHasHeader(
  firstRow: string[] | undefined,
  locale: string,
): boolean {
  if (!firstRow || firstRow.length === 0) return false;
  const cells = firstRow.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length === 0) return false;

  // Any cell matches a known language name → very strong signal.
  for (const cell of cells) {
    for (const lang of SUPPORTED_LANGUAGES) {
      if (cellMatchesLanguage(cell, lang.code, locale)) return true;
    }
  }

  // All cells short + no sentence punctuation → likely a header.
  const allShort = cells.every((c) => c.length <= 24);
  const noSentencePunct = cells.every((c) => !/[.?!…]/.test(c));
  const fewWords = cells.every((c) => c.split(/\s+/).length <= 3);
  return allShort && noSentencePunct && fewWords;
}

/**
 * Auto-assign columns to course languages by matching the header row.
 * Returns a fresh mapping. Does not touch cells that can't be confidently
 * matched. The user still has to fill those in.
 */
export function autoMapColumns(
  headerRow: string[] | undefined,
  courseLanguages: string[],
  locale: string,
): Record<string, number> {
  const mapping: Record<string, number> = {};
  if (!headerRow) return mapping;
  const used = new Set<number>();
  for (const lang of courseLanguages) {
    for (let i = 0; i < headerRow.length; i++) {
      if (used.has(i)) continue;
      const cell = headerRow[i] ?? '';
      if (cellMatchesLanguage(cell, lang, locale)) {
        mapping[lang] = i;
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}
