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
import { getRomanizationSource } from './localRomanization';
import type { FunctionReference, Scheduler } from 'convex/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
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
  /**
   * The exact `translations` row to annotate. Required for a superseded
   * revision (the store cannot find those by (text, language)); absent means
   * the live row. Ignored by the source-text actions.
   */
  translationId?: Id<'translations'>;
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
  /**
   * The engine tag a row written today would carry. Read by
   * `missingAnnotationKinds`, so a row produced by an older engine is
   * refreshed the next time the card is viewed rather than waiting for a
   * migration.
   */
  currentSource: (language: string) => string;
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
    currentSource: getRomanizationSource,
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
    currentSource: getIpaSource,
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
    currentSource: getFuriganaSource,
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

const ANNOTATION_FIELDS: AnnotationField[] = ANNOTATION_KINDS.flatMap(
  (kind) => [
    TEXT_ANNOTATIONS[kind].textField,
    TEXT_ANNOTATIONS[kind].sourceField,
  ],
);

/**
 * The annotation values and engine tags of a `texts` / `translations` row,
 * as the spread the probes and the store mutations read. The one place a
 * projection spells the six fields out: a reader that copied them by hand
 * and forgot a tag could only see "a value is present", so a row produced by
 * a retired engine looked complete and a stale transcription survived a
 * version bump until someone ran the migration.
 */
export function annotationFieldsOf(row: AnnotationFields): AnnotationFields {
  const out: AnnotationFields = {};
  for (const field of ANNOTATION_FIELDS) {
    const value = row[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/**
 * Kinds this row still needs for `language`: supported, and either never
 * attempted (`=== undefined`) or produced by an engine we no longer ship.
 *
 * The stale-engine half is what makes a version bump self-healing. Without
 * it, bumping IPA_SOURCES only changed the tag on FUTURE writes, and existing
 * rows kept their old value until someone remembered to run the reset
 * migration — so a user looking at their library went on seeing the broken
 * transcription the bump was meant to replace. The migration is still there
 * for a bulk sweep; this is what fixes a row the moment it is looked at.
 *
 * The `''` failure sentinel is deliberately not "missing" for the CURRENT
 * engine (see the schema note): that engine already tried and failed, and
 * retrying it on every view would be a per-view call that always fails, and
 * a paid one on the two model-routed languages. A stale sentinel IS
 * retried, because a new engine deserves its own attempt. A failure that
 * says nothing about the text (a missing key, a rate limit, an outage)
 * never becomes a sentinel at all: the runners re-throw
 * TransientAnnotationError and the field stays undefined for the next view.
 *
 * Callers throw ProbeNeedsWork / schedule the kind's action per entry.
 */
/**
 * How long an annotation request is honoured before a sweep asks again. A
 * transient failure (`TransientAnnotationError`) leaves the value undefined
 * so the row is retried, and this claim keeps the retry to once per window
 * instead of once per view: during an OpenRouter or Google outage every
 * review's 20-card probe would otherwise schedule the failing action again
 * for every affected row. Same shape as `renderingStampRequestedAt`.
 */
export const ANNOTATION_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;

/** Whether a recent request for this row's annotations is still honoured. */
export function annotationRequestInFlight(row: {
  annotationRequestedAt?: number;
}): boolean {
  return (
    row.annotationRequestedAt !== undefined &&
    Date.now() - row.annotationRequestedAt < ANNOTATION_REQUEST_COOLDOWN_MS
  );
}

/**
 * Whether a sweep would schedule annotations for this row now: something is
 * missing AND no recent request is in flight. The probe-mode test of the
 * sweeps, so a probe reports no work for a row in cooldown.
 */
export function annotationsDue(
  language: string,
  row: AnnotationFields & { annotationRequestedAt?: number },
): boolean {
  return (
    missingAnnotationKinds(language, row).length > 0 &&
    !annotationRequestInFlight(row)
  );
}

export function missingAnnotationKinds(
  language: string,
  row: AnnotationFields,
): AnnotationKind[] {
  return ANNOTATION_KINDS.filter((kind) => {
    const spec = TEXT_ANNOTATIONS[kind];
    if (!spec.supports(language)) return false;
    const value = row[spec.textField];
    if (value === undefined) return true;
    const source = row[spec.sourceField];
    // An UNTAGGED row is left alone. Its value predates the source field, so
    // there is nothing to compare and no way to tell a good row from a stale
    // one — and treating it as stale would re-attempt every `''` sentinel on
    // every view, which is a call that already failed. The reset migration
    // clears those in bulk instead.
    if (source === undefined) return false;
    return source !== spec.currentSource(language);
  });
}

/**
 * Patch/insert spread that removes every annotation value + source tag.
 * Used when the underlying text changes and derived annotations no longer
 * match (`ctx.db.patch` treats `undefined` as "unset the field").
 */
export function clearedAnnotationFields(): Record<
  AnnotationField | 'annotationRequestedAt',
  undefined
> {
  return {
    // A new wording is requested at once, whatever the old one's claim.
    annotationRequestedAt: undefined,
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
 * Drop entries whose language the kind no longer supports, from a
 * language-keyed annotation record (`cardApprovals.entryIpa` and friends).
 *
 * The record equivalent of the per-language `spec.supports` gate in
 * lib/cardContent.ts, and it exists for the same reason: a language that
 * loses support keeps its stored rows, but they stop being served. Approvals
 * predate the Sep 2026 espeak removals, so without this an old proposal
 * would still render the mangled Thai or Hebrew line the removal was meant
 * to retire.
 */
export function supportedAnnotationEntries(
  kind: AnnotationKind,
  byLanguage: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (byLanguage === undefined) return undefined;
  const spec = TEXT_ANNOTATIONS[kind];
  return Object.fromEntries(
    Object.entries(byLanguage).filter(([language]) => spec.supports(language)),
  );
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
  // v2 (Sep 2026) covers three changes at once, since none of them shipped
  // separately:
  //   - cleanEspeakIpa folds the Danish `?` glottal stop to `ʔ` and drops the
  //     stray Icelandic `#`.
  //   - ipaForText rejects a transcription where espeak switched language
  //     mid-sentence, which left the switched word as raw text ("And you?" on
  //     a French card rendered as "(en)and(fr) jˈu"). Those rows land on the
  //     `''` sentinel and are not retried: the failure is deterministic, so a
  //     second attempt would produce the same broken line.
  //   - the languages that lost their `ipaVoice` (th, he, ar + dialects, zh,
  //     yue, vi, ko) have their rows cleared and never refilled, because they
  //     left IPA_LANGUAGES.
  // A bump refreshes a stale row lazily the next time its card is viewed
  // (missingAnnotationKinds). The reset pair in convex/migrations.ts is the
  // bulk sweep, and the only path for the third change: a language that left
  // IPA_LANGUAGES is never probed, so nothing but the sweep clears its rows.
  espeakNg: 'espeak-ng-emscripten-0.3.5-v2',
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
/**
 * A failure that says nothing about the TEXT — a missing API key, a rate
 * limit, a provider outage. The runners re-throw it instead of persisting the
 * `''` sentinel.
 *
 * The sentinel means "this engine cannot transcribe this input", and it is
 * permanent by design: nothing re-enqueues a row that has one. That is right
 * for espeak, which is deterministic local compute where the first failure is
 * as good as the third. It is badly wrong for a network engine, where the
 * usual failure is that the deployment has no `OPENROUTER_API_KEY` — running
 * a language through that once would stamp every row as untranscribable and
 * the language would stay blank forever, long after the key was set.
 */
export class TransientAnnotationError extends Error {
  // No `cause` option: the two-argument Error constructor is ES2022 and the
  // Convex runtime typechecks against ES2021 (see convex/tsconfig.json), so
  // it does not compile there. Callers put the detail in the message instead.
  constructor(message: string) {
    super(message);
    this.name = 'TransientAnnotationError';
  }
}

/**
 * What to store for a romanization that failed while the TRANSLATION was
 * being written (the inline sites in llmTranslationQueue.ts and
 * translationPipeline.ts romanize before the row exists). A transient
 * failure (rate limit, missing key, 5xx) is not a fact about the text: the
 * field stays undefined and the annotation sweep asks again on the next
 * view, the rule `runTranslationAnnotation` applies. Anything else persists
 * the `''` sentinel so the failing input is not re-bought on every view.
 */
export function romanizationAfterFailure(
  err: unknown,
  context: string,
): string | undefined {
  if (err instanceof TransientAnnotationError) {
    console.warn(`${context}: romanization deferred (transient):`, err.message);
    return undefined;
  }
  console.error(
    `${context}: romanization failed (persisting sentinel):`,
    err instanceof Error ? err.message : err,
  );
  return '';
}

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
    // A configuration or transport failure is not a fact about this text, so
    // it must not be recorded as one. Leaving the field undefined means the
    // row is picked up again on the next view.
    if (err instanceof TransientAnnotationError) throw err;
    // Persist the empty-string sentinel so ensureTextContent doesn't
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
    if (err instanceof TransientAnnotationError) throw err;
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
    translationId: args.translationId,
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
      // Same rule as the source/translation runners: a configuration or
      // transport failure is not a fact about this text.
      if (err instanceof TransientAnnotationError) throw err;
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

/**
 * Schedule the generate-and-store action for every annotation kind `row`
 * still lacks (`missingAnnotationKinds`, so the '' sentinel is never
 * retried). `translationId` names the exact row the store patches: pass the
 * id for a superseded revision (the store cannot find those by
 * (text, language)) and `undefined` for the live row, which the store then
 * resolves itself. Returns the kinds it scheduled.
 */
export async function scheduleTranslationAnnotations(
  ctx: { scheduler: Scheduler; db: Pick<MutationCtx['db'], 'patch'> },
  row: Pick<
    Doc<'translations'>,
    | '_id'
    | 'textId'
    | 'targetLanguage'
    | 'translatedText'
    | 'annotationRequestedAt'
    | AnnotationField
  >,
  translationId: Id<'translations'> | undefined,
): Promise<AnnotationKind[]> {
  const kinds = missingAnnotationKinds(row.targetLanguage, row);
  // Nothing missing, or a request inside the cooldown is still in flight
  // (`annotationRequestInFlight`): the action is not scheduled twice.
  if (kinds.length === 0 || annotationRequestInFlight(row)) return [];
  // Always name the row. Falling back to "the store will find it by
  // (text, language)" silently targeted the WRONG row whenever a text
  // had sentence-form variants: liveTranslation matches
  // `variantKey === undefined`, so a variant's romanization was written
  // onto its base sibling and the variant stayed blank forever. That is
  // why "And you?" showed แล้วเธอล่ะ with no romanization while its base
  // แล้วคุณล่ะครับ had one.
  const target = translationId ?? row._id;
  await ctx.db.patch(target, { annotationRequestedAt: Date.now() });
  for (const kind of kinds) {
    await ctx.scheduler.runAfter(0, TEXT_ANNOTATIONS[kind].translationAction, {
      textId: row.textId,
      text: row.translatedText,
      language: row.targetLanguage,
      translationId: target,
    });
  }
  return kinds;
}
