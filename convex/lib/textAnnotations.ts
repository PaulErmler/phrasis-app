/**
 * Registry for per-sentence "annotation" fields: derived text stored beside
 * a sentence (on `texts`) and beside each translation (on `translations`),
 * generated lazily by a scheduled action and rendered alongside the sentence.
 *
 * Three kinds exist today:
 *   - romanization: Latin transliteration for non-Latin scripts
 *     (`romanizedText` / `romanizationSource`, sync V8 libraries + Google v3;
 *     see convex/lib/localRomanization.ts).
 *   - ipa: IPA transcription via espeak-ng
 *     (`ipaText` / `ipaSource`, Node runtime; see convex/features/ipa.ts).
 *   - furigana: kana readings over kanji runs, Japanese only
 *     (`furiganaText` / `furiganaSource`, Node runtime; see
 *     convex/features/furigana.ts). The one kind that does NOT render as a
 *     line under the sentence — it is ruby laid over the sentence itself, so
 *     the client reads it through lib/furigana.ts instead of AnnotationLines.
 *
 * All three share the tri-state contract documented on `texts.romanizedText` in
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
import {
  FURIGANA_LANGUAGES,
  IPA_LANGUAGES,
  ROMANIZATION_LANGUAGES,
} from '../../lib/languages';

export const ANNOTATION_KINDS = ['romanization', 'ipa', 'furigana'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Args validator for the generic store mutations in decks.ts. */
export const vAnnotationKind = v.union(
  v.literal('romanization'),
  v.literal('ipa'),
  v.literal('furigana'),
);

export type AnnotationField =
  | 'romanizedText'
  | 'romanizationSource'
  | 'ipaText'
  | 'ipaSource'
  | 'furiganaText'
  | 'furiganaSource';

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

/** Args shape shared by the per-kind approval actions (ipa.ts / furigana.ts). */
type ApprovalAnnotationAction = FunctionReference<
  'action',
  'internal',
  {
    approvalId: Id<'cardApprovals'>;
    entries: Array<{ language: string; text: string }>;
  },
  null
>;

export interface TextAnnotationSpec {
  /** Value field on `texts` / `translations` rows (tri-state, see above). */
  textField: 'romanizedText' | 'ipaText' | 'furiganaText';
  /** Provenance tag field, written together with the value. */
  sourceField: 'romanizationSource' | 'ipaSource' | 'furiganaSource';
  /** Whether this language gets the annotation at all. */
  supports: (language: string) => boolean;
  /** Action that annotates a source text (writes via storeSourceAnnotation). */
  sourceTextAction: AnnotationAction;
  /** Action that annotates a translation (writes via storeTranslationAnnotation). */
  translationAction: AnnotationAction;
  /**
   * Action that annotates a chat approval's proposed entries before they are
   * stored rows (scheduleApprovalAnnotations in chat/cardApprovals.ts).
   * Absent for kinds the approval card doesn't precompute.
   */
  approvalAction?: ApprovalAnnotationAction;
  /** Record field on `cardApprovals` the kind's approval results land in. */
  approvalEntryField?: 'entryIpa' | 'entryFurigana';
  /** Key this kind occupies on projected card content (lib/cardContent.ts). */
  projectedField: 'romanization' | 'ipa' | 'furigana';
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
    translationAction:
      internal.features.decks.processRomanizationForTranslation,
    projectedField: 'romanization',
    inSearchableText: true,
  },
  ipa: {
    textField: 'ipaText',
    sourceField: 'ipaSource',
    supports: (language) => IPA_LANGUAGES.has(language),
    sourceTextAction: internal.features.ipa.processIpaForSourceText,
    translationAction: internal.features.ipa.processIpaForTranslation,
    approvalAction: internal.features.ipa.processIpaForApproval,
    approvalEntryField: 'entryIpa',
    projectedField: 'ipa',
    inSearchableText: false,
  },
  furigana: {
    textField: 'furiganaText',
    sourceField: 'furiganaSource',
    supports: (language) => FURIGANA_LANGUAGES.has(language),
    sourceTextAction: internal.features.furigana.processFuriganaForSourceText,
    translationAction: internal.features.furigana.processFuriganaForTranslation,
    approvalAction: internal.features.furigana.processFuriganaForApproval,
    approvalEntryField: 'entryFurigana',
    projectedField: 'furigana',
    // The annotation is the sentence itself plus bracketed readings, so
    // indexing it would duplicate every Japanese sentence in the search
    // string for no gain — the bare sentence is already indexed.
    inSearchableText: false,
  },
};

/** Row shape the helpers below need: just the annotation value/source fields. */
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
    furiganaText: undefined,
    furiganaSource: undefined,
  };
}

/**
 * Insert spread that carries a row's annotations onto a logical copy
 * (scheduling.ts Path B). Values travel with their source tags; pairs the
 * row never had stay absent so the lazy pipeline fills them on the copy.
 */
export function carriedAnnotationFields(
  row: AnnotationFields,
): AnnotationFields {
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

/**
 * Stable identifiers for the furigana engine, persisted as `furiganaSource`.
 * Same invalidate-by-source contract as IPA_SOURCES above: bump the `-v<n>`
 * suffix when the analyzer, its dictionary, or the reading-fitting rules
 * change in a way that should regenerate existing rows.
 */
export const FURIGANA_SOURCES = {
  // v2: serializer emits the ｜ base-boundary marker for ambiguous adjacency
  // (lib/furigana.ts); v1 strings parse but can mis-scope a reading when an
  // un-annotated kanji run directly precedes an annotated one.
  linderaIpadic: 'lindera-ipadic-2.0.0-v2',
} as const;

export type FuriganaSource =
  (typeof FURIGANA_SOURCES)[keyof typeof FURIGANA_SOURCES];

/** All furigana comes from the one analyzer build; mirror of getIpaSource. */
export function getFuriganaSource(_language: string): FuriganaSource {
  return FURIGANA_SOURCES.linderaIpadic;
}

// ---------------------------------------------------------------------------
// Generic action bodies. The per-kind Node actions (ipa.ts, furigana.ts) were
// verbatim clones of each other with the nouns swapped — the same
// try/generate/sentinel/store shape, which meant every fix (e.g. the forText
// staleness guard) had to be applied to six bodies. Each action now declares
// runtime + engine and delegates here. V8-safe: the engine arrives as a
// callback, this module never imports one.

type AnnotationActionCtx = {
  runMutation: (
    ref: FunctionReference<
      'mutation',
      'internal',
      Record<string, unknown>,
      null
    >,
    args: Record<string, unknown>,
  ) => Promise<null>;
};

/** Generate + store for a source text row; failures persist the '' sentinel. */
export async function runSourceAnnotation(
  ctx: AnnotationActionCtx,
  kind: AnnotationKind,
  args: AnnotationActionArgs,
  generate: (text: string, language: string) => Promise<string>,
  source: string,
): Promise<null> {
  let value: string;
  try {
    value = await generate(args.text, args.language);
  } catch (err) {
    // Persist the empty-string sentinel so scheduleMissingContent doesn't
    // re-enqueue the same failing input on every ensureContent call.
    console.error(`Source ${kind} error (persisting sentinel):`, err);
    value = '';
  }
  // Source recorded even on failure: lets an engine swap target failed
  // rows by the source that produced the sentinel.
  await ctx.runMutation(internal.features.decks.storeSourceAnnotation, {
    textId: args.textId,
    kind,
    value,
    source,
    forText: args.text,
  });
  return null;
}

/** Generate + store for a translation row; failures persist the '' sentinel. */
export async function runTranslationAnnotation(
  ctx: AnnotationActionCtx,
  kind: AnnotationKind,
  args: AnnotationActionArgs,
  generate: (text: string, language: string) => Promise<string>,
  source: string,
): Promise<null> {
  let value: string;
  try {
    value = await generate(args.text, args.language);
  } catch (err) {
    console.error(`Translation ${kind} error (persisting sentinel):`, err);
    value = '';
  }
  await ctx.runMutation(internal.features.decks.storeTranslationAnnotation, {
    textId: args.textId,
    language: args.language,
    kind,
    value,
    source,
    forText: args.text,
  });
  return null;
}

/**
 * Generate + store for a chat approval's proposed entries. Proposals live
 * only on the `cardApprovals` row (no texts/translations rows exist until
 * approval), so they get their own store path. One action per proposal, all
 * entries in one pass. Results carry the text they were computed for; the
 * store mutation drops any whose entry has since been edited.
 */
export async function runApprovalAnnotation(
  ctx: AnnotationActionCtx,
  kind: AnnotationKind,
  args: {
    approvalId: Id<'cardApprovals'>;
    entries: Array<{ language: string; text: string }>;
  },
  generate: (text: string, language: string) => Promise<string>,
): Promise<null> {
  const results: Array<{ language: string; forText: string; value: string }> =
    [];
  for (const entry of args.entries) {
    let value: string;
    try {
      value = await generate(entry.text, entry.language);
    } catch (err) {
      console.error(
        `Approval ${kind} error for ${entry.language} (persisting sentinel):`,
        err,
      );
      value = '';
    }
    results.push({ language: entry.language, forText: entry.text, value });
  }
  if (results.length > 0) {
    await ctx.runMutation(
      internal.features.chat.cardApprovals.storeApprovalEntryAnnotations,
      { approvalId: args.approvalId, kind, results },
    );
  }
  return null;
}
