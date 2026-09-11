import { resolveShowFurigana } from './furigana';
import {
  glossLanguageFor,
  hyperliteralApplies,
  languageNeedsFurigana,
  languageNeedsIpa,
  languageNeedsRomanization,
} from './languages';

/**
 * Which reading aids a card shows, per language.
 *
 * Each aid has a course-wide switch and an optional per-language exception, so
 * a learner reading Japanese and Korean can keep romanization under the Korean
 * and drop it under the Japanese. This module is the one definition of how the
 * two combine, imported by both the client (what to render) and the content
 * sweep (what to generate), so "what the card shows" and "what gets made" can
 * never drift apart.
 *
 * Kept free of Convex imports so both sides can use it.
 */

export type AnnotationKindName =
  | 'romanization'
  | 'ipa'
  | 'furigana'
  | 'hyperliteral';

export const ANNOTATION_KIND_NAMES: readonly AnnotationKindName[] = [
  'romanization',
  'ipa',
  'furigana',
  'hyperliteral',
];

/** What one language's line should show. */
export type AnnotationDisplay = Record<AnnotationKindName, boolean>;

/** The slice of course settings this module reads. */
export type AnnotationSettings = {
  showRomanization?: boolean;
  showIpa?: boolean;
  showFurigana?: boolean;
  showHyperliteral?: boolean;
  annotationOverrides?: Record<
    string,
    Partial<Record<AnnotationKindName, boolean>>
  >;
};

/** The slice of a course this module reads. */
export type AnnotationCourse = { baseLanguages?: string[] };

/**
 * The course-wide value of one aid.
 *
 * Romanization defaults ON and IPA OFF, which is the split the settings sheet
 * has always had: romanization is the expected reading help for a non-Latin
 * script, IPA is a specialist aid that should not appear unasked. The gloss
 * defaults OFF here so no existing course gains it silently; a course created
 * after the feature shipped carries an explicit `true` on its settings row.
 */
function courseWide(
  settings: AnnotationSettings | null | undefined,
  kind: AnnotationKindName,
): boolean {
  switch (kind) {
    case 'romanization':
      return settings?.showRomanization ?? true;
    case 'ipa':
      return settings?.showIpa ?? false;
    case 'furigana':
      return resolveShowFurigana(settings);
    case 'hyperliteral':
      // OFF when unset, so no existing course silently starts buying a model
      // call per sentence. A course created after the feature shipped is not
      // unset: `NEW_COURSE_SETTINGS_DEFAULTS` stamps an explicit `true` on its
      // settings row, which is what makes the gloss on-by-default for new
      // users without touching anyone else.
      return settings?.showHyperliteral ?? false;
  }
}

/**
 * What a caller knows about the gloss: the language it is written in, and the
 * course languages it is generated for.
 *
 * `appliesTo` is the course's TARGET languages. A base language is the one the
 * learner already reads, so glossing it word-for-word teaches nothing, and
 * `hyperliteralWantsFor` never asks for one. Callers that gate on the gloss
 * must use the same list or they will wait forever for a gloss nobody makes.
 *
 * Passing no scope at all means the caller CANNOT compute it (the library word
 * list, the collection preview: neither knows the course's languages). Those
 * surfaces skip the gate rather than guess, which is safe because the server
 * only ever sends a gloss for a row it generated one for.
 */
export type GlossScope = {
  language: string;
  appliesTo: readonly string[];
};

/**
 * Whether the aid exists for this language at all. A switch that is on for a
 * language with no romanizer shows nothing, so this gates both the settings
 * chips and the resolved display — a stale override for a language that later
 * lost support can never resurrect a line.
 */
export function annotationAppliesTo(
  kind: AnnotationKindName,
  language: string,
  gloss?: GlossScope,
): boolean {
  switch (kind) {
    case 'romanization':
      return languageNeedsRomanization(language);
    case 'ipa':
      return languageNeedsIpa(language);
    case 'furigana':
      return languageNeedsFurigana(language);
    case 'hyperliteral':
      // No scope: the caller cannot compute one, so it trusts the server's
      // gate instead of applying a wrong one. See `GlossScope`.
      if (gloss === undefined) return true;
      return (
        gloss.appliesTo.includes(language) &&
        hyperliteralApplies(language, gloss.language)
      );
  }
}

/**
 * What `language` should show: the per-language exception when there is one,
 * else the course-wide switch, and always false where the language has no such
 * aid.
 */
export function resolveAnnotationDisplay(
  settings: AnnotationSettings | null | undefined,
  language: string,
  gloss?: GlossScope,
): AnnotationDisplay {
  const override = settings?.annotationOverrides?.[language];
  const out = {} as AnnotationDisplay;
  for (const kind of ANNOTATION_KIND_NAMES) {
    out[kind] =
      annotationAppliesTo(kind, language, gloss) &&
      (override?.[kind] ?? courseWide(settings, kind));
  }
  return out;
}

/** `resolveAnnotationDisplay` for a whole course, keyed by language. */
export function annotationDisplayByLanguage(
  settings: AnnotationSettings | null | undefined,
  languages: readonly string[],
  gloss?: GlossScope,
): Record<string, AnnotationDisplay> {
  const out: Record<string, AnnotationDisplay> = {};
  for (const language of languages) {
    out[language] = resolveAnnotationDisplay(settings, language, gloss);
  }
  return out;
}

/**
 * Which languages of this course want a hyperliteral gloss, and in what
 * language to write it. `undefined` when none do, which is the signal the
 * content sweep reads to skip the whole kind — and the reason a course with
 * the switch off never pays for a model call.
 *
 * TARGET languages only. A base language is the one the learner already reads,
 * so glossing it word-for-word teaches nothing and would double the spend.
 *
 * `languages` has to travel with `glossLanguage` wherever this goes. The card
 * projection asks "is a gloss missing?" per language, and if it asks over a
 * wider set than this one it reports a gap the sweep will never fill: the card
 * never completes and `useEnsureContent` re-fires every 15s forever. That is
 * invisible on an English-base course, where the base language IS the gloss
 * language and drops out on its own, and bites every other course.
 *
 * Unlike romanization and IPA, which generate for every supported row whatever
 * the settings say, a gloss costs a model call per sentence per gloss
 * language, so generation follows the setting rather than the language.
 */
export type HyperliteralWants = {
  glossLanguage: string;
  /**
   * An array rather than a Set: this crosses a Convex function boundary
   * (`prepareCardContent`'s args), and a Set is not a Convex value. Mutable
   * for the same reason — a Convex validator's inferred type is not readonly.
   * At most a handful of course languages, so membership is a scan.
   */
  languages: string[];
};

export function hyperliteralWantsFor(
  course: AnnotationCourse & { targetLanguages?: string[] },
  settings: AnnotationSettings | null | undefined,
): HyperliteralWants | undefined {
  const targets = [...new Set(course.targetLanguages ?? [])];
  const gloss: GlossScope = {
    language: glossLanguageFor(course),
    appliesTo: targets,
  };
  const wanted = targets.filter(
    (language) =>
      resolveAnnotationDisplay(settings, language, gloss).hyperliteral,
  );
  return wanted.length === 0
    ? undefined
    : { glossLanguage: gloss.language, languages: wanted };
}

/**
 * The `AnnotationLines` visibility props for one language.
 *
 * Card surfaces receive `annotationDisplay` (per language) and, from older
 * callers, the course-wide booleans. This resolves the pair at the point of
 * render, where the line's language is in scope, so a surface that has not yet
 * been given the record keeps its current behaviour exactly.
 */
export function annotationLineProps(
  byLanguage: Record<string, AnnotationDisplay> | undefined,
  language: string,
  fallback?: {
    showRomanization?: boolean;
    showIpa?: boolean;
    showHyperliteral?: boolean;
  },
): { showRomanization: boolean; showIpa: boolean; showHyperliteral: boolean } {
  const resolved = byLanguage?.[language];
  return {
    showRomanization:
      resolved?.romanization ?? fallback?.showRomanization ?? true,
    showIpa: resolved?.ipa ?? fallback?.showIpa ?? false,
    showHyperliteral:
      resolved?.hyperliteral ?? fallback?.showHyperliteral ?? false,
  };
}

/**
 * Whether to show furigana for one language. Separate from
 * `annotationLineProps` because furigana is not an annotation LINE: it renders
 * as ruby over the sentence itself, so its call sites pass a value rather than
 * spreading props. Without this the settings sheet would write a furigana
 * override that nothing ever reads.
 */
export function showFuriganaFor(
  byLanguage: Record<string, AnnotationDisplay> | undefined,
  language: string,
  fallback?: boolean,
): boolean {
  return byLanguage?.[language]?.furigana ?? fallback ?? true;
}

/**
 * The three `*FromSettings` helpers below serve surfaces that hold course
 * settings but not the course's languages: the library word list, the
 * collection preview. They are `resolveAnnotationDisplay` with no `GlossScope`,
 * which is what "I cannot compute the gloss gate, trust the server's" is
 * spelled as. Everything else resolves identically, and deliberately so — one
 * definition, so a surface cannot show something the sweep never made.
 */

/** `annotationLineProps` for a surface that has settings rather than the record. */
export function annotationLinePropsFromSettings(
  settings: AnnotationSettings | null | undefined,
  language: string,
): { showRomanization: boolean; showIpa: boolean; showHyperliteral: boolean } {
  const resolved = resolveAnnotationDisplay(settings, language);
  return {
    showRomanization: resolved.romanization,
    showIpa: resolved.ipa,
    showHyperliteral: resolved.hyperliteral,
  };
}

/** `annotationDisplayByLanguage` for a surface that has settings rather than
 *  the course. */
export function annotationDisplayFromSettings(
  settings: AnnotationSettings | null | undefined,
  languages: readonly string[],
): Record<string, AnnotationDisplay> {
  return annotationDisplayByLanguage(settings, languages);
}

/** `showFuriganaFor` for a surface that has settings rather than the record. */
export function showFuriganaFromSettings(
  settings: AnnotationSettings | null | undefined,
  language: string,
): boolean {
  return resolveAnnotationDisplay(settings, language).furigana;
}
