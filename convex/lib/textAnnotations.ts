/**
 * Registry for per-sentence "annotation" fields: derived text stored beside
 * a sentence (on `texts`) and beside each translation (on `translations`),
 * generated lazily by a scheduled action, displayed as a muted line under
 * the sentence.
 *
 * Two kinds exist today:
 *   - romanization: Latin transliteration for non-Latin scripts
 *     (`romanizedText` / `romanizationSource`, sync V8 libraries + Google v3;
 *     see convex/lib/localRomanization.ts).
 *   - ipa: IPA transcription via espeak-ng
 *     (`ipaText` / `ipaSource`, Node runtime; see convex/features/ipa.ts).
 *
 * Both share the tri-state contract documented on `texts.romanizedText` in
 * convex/schema.ts: `undefined` = never attempted (schedulers enqueue),
 * `''` = attempted and failed (sentinel, never re-enqueued), non-empty =
 * done. Always test `=== undefined`.
 *
 * This module must stay importable from the default (V8) runtime: no espeak
 * import, only `internal.*` function references for the Node-side actions.
 */

import { v } from 'convex/values';
import type { FunctionReference } from 'convex/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { IPA_LANGUAGES, ROMANIZATION_LANGUAGES } from '../../lib/languages';

export const ANNOTATION_KINDS = ['romanization', 'ipa'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Args validator for the generic store mutations in decks.ts. */
export const vAnnotationKind = v.union(
  v.literal('romanization'),
  v.literal('ipa'),
);

export type AnnotationField =
  | 'romanizedText'
  | 'romanizationSource'
  | 'ipaText'
  | 'ipaSource';

/** Both process actions of a kind take the same args (see decks.ts / ipa.ts). */
type AnnotationActionArgs = {
  textId: Id<'texts'>;
  text: string;
  language: string;
};
type AnnotationAction = FunctionReference<
  'action',
  'internal',
  AnnotationActionArgs,
  null
>;

export interface TextAnnotationSpec {
  /** Value field on `texts` / `translations` rows (tri-state, see above). */
  textField: 'romanizedText' | 'ipaText';
  /** Provenance tag field, written together with the value. */
  sourceField: 'romanizationSource' | 'ipaSource';
  /** Whether this language gets the annotation at all. */
  supports: (language: string) => boolean;
  /** Action that annotates a source text (writes via storeSourceAnnotation). */
  sourceTextAction: AnnotationAction;
  /** Action that annotates a translation (writes via storeTranslationAnnotation). */
  translationAction: AnnotationAction;
  /**
   * Whether a landed value belongs in cards' `searchableText`. True for
   * romanization (users type Latin to find cards); false for IPA (nobody
   * searches by IPA symbols, and indexing them would bloat the search string).
   */
  inSearchableText: boolean;
}

export const TEXT_ANNOTATIONS: Record<AnnotationKind, TextAnnotationSpec> = {
  romanization: {
    textField: 'romanizedText',
    sourceField: 'romanizationSource',
    supports: (language) => ROMANIZATION_LANGUAGES.has(language),
    sourceTextAction: internal.features.decks.processRomanizationForSourceText,
    translationAction: internal.features.decks.processRomanizationForTranslation,
    inSearchableText: true,
  },
  ipa: {
    textField: 'ipaText',
    sourceField: 'ipaSource',
    supports: (language) => IPA_LANGUAGES.has(language),
    sourceTextAction: internal.features.ipa.processIpaForSourceText,
    translationAction: internal.features.ipa.processIpaForTranslation,
    inSearchableText: false,
  },
};

/** Row shape the helpers below need: just the four annotation fields. */
export type AnnotationFields = Partial<Record<AnnotationField, string>>;

/**
 * Kinds this row still needs for `language`: supported, and never attempted
 * (`=== undefined`; the `''` failure sentinel is deliberately not "missing",
 * see the schema note). Callers throw ProbeNeedsWork / schedule the kind's
 * action per entry.
 */
export function missingAnnotationKinds(
  language: string,
  row: AnnotationFields,
): AnnotationKind[] {
  return ANNOTATION_KINDS.filter(
    (kind) =>
      TEXT_ANNOTATIONS[kind].supports(language) &&
      row[TEXT_ANNOTATIONS[kind].textField] === undefined,
  );
}

/**
 * Patch/insert spread that removes every annotation value + source tag.
 * Used when the underlying text changes and derived annotations no longer
 * match (`ctx.db.patch` treats `undefined` as "unset the field").
 */
export function clearedAnnotationFields(): Record<AnnotationField, undefined> {
  return {
    romanizedText: undefined,
    romanizationSource: undefined,
    ipaText: undefined,
    ipaSource: undefined,
  };
}

/**
 * Insert spread that carries a row's annotations onto a logical copy
 * (scheduling.ts Path B). Values travel with their source tags; pairs the
 * row never had stay absent so the lazy pipeline fills them on the copy.
 */
export function carriedAnnotationFields(row: AnnotationFields): AnnotationFields {
  const out: AnnotationFields = {};
  for (const kind of ANNOTATION_KINDS) {
    const spec = TEXT_ANNOTATIONS[kind];
    const value = row[spec.textField];
    if (value !== undefined) {
      out[spec.textField] = value;
      const source = row[spec.sourceField];
      if (source !== undefined) out[spec.sourceField] = source;
    }
  }
  return out;
}

/**
 * Stable identifiers for the IPA engine, persisted as `ipaSource` alongside
 * `ipaText` (including the `''` failure sentinel). Same invalidate-by-source
 * migration pattern as ROMANIZATION_SOURCES in localRomanization.ts: bump the
 * `-v<n>` suffix when the engine or its post-processing changes in a way that
 * should regenerate existing rows. Lives here (not in features/ipa.ts) so V8
 * modules can read it without touching the Node-only espeak import.
 */
export const IPA_SOURCES = {
  espeakNg: 'espeak-ng-emscripten-0.3.5-v1',
} as const;

export type IpaSource = (typeof IPA_SOURCES)[keyof typeof IPA_SOURCES];

/** All IPA today comes from the one espeak build; mirror of getRomanizationSource. */
export function getIpaSource(_language: string): IpaSource {
  return IPA_SOURCES.espeakNg;
}
