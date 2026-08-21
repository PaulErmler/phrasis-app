import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
} from '../lib/constants/audioPlayback';
import { postProcessTranslation } from '../lib/languages';
import {
  getRomanizationSource,
  romanizeLocal,
  ROMANIZATION_SOURCES,
} from './lib/localRomanization';
import { isProtectedTranslationSource } from '../lib/translationProvenance';
import { buildSearchableTextPatchForCard } from './lib/cardContent';
import type { Id } from './_generated/dataModel';
import { isPremadeLevelCollection } from './lib/collections';
import {
  cardsByOriginStateAndDueDate,
  cardsByOriginWritingStateAndDueDate,
  hasWritingTrack,
} from './db/stats/cardAggregates';

// App-wide migrations via @convex-dev/migrations: batched, resumable, with
// state tracking so completed migrations are skipped on re-run. `runAll` is
// chained after every deploy (`npx convex deploy ... && npx convex run
// migrations:runAll --prod`); append new migrations to its list.
//
// The hand-rolled batch jobs in convex/migrations/ predate this component and
// stay as-is (they're parameterized/one-off dashboard tools, not deploy-time
// backfills).
export const migrations = new Migrations<DataModel>(components.migrations);

/** Generic runner: npx convex run migrations:run '{"fn": "migrations:<name>"}' */
export const run = migrations.runner();

/**
 * Backfill for the per-mode playback-settings split (see
 * docs/migrations/per-mode-settings-backfill.md).
 *
 * Deployment does NOT depend on it. Writing modes read
 * `*Transcribe ?? *Full ?? <audio field> ?? DEFAULT_*`, but once it has run,
 * the `?? <audio field>` compatibility branch for the `*Full` set becomes
 * dead code. Per-field `undefined` guards keep it idempotent; user writes are
 * never overwritten. The `*Transcribe` / `transcribeAfter*` fields are
 * deliberately NOT stamped: Transcribe shipped after the split, so inheriting
 * from the `*Full` set is its intended default, not a compatibility shim.
 */
export const perModeSettingsBackfill = migrations.define({
  table: 'courseSettings',
  migrateOne: (_ctx, doc) => {
    const patch: Partial<Doc<'courseSettings'>> = {};

    // Writing-mode ("full") copies of the audio playback settings, stamped
    // from the doc's current effective audio values.
    if (doc.highlightWordsFull === undefined && doc.highlightWords !== undefined) {
      patch.highlightWordsFull = doc.highlightWords;
    }
    if (doc.autoPlayAudioFull === undefined) {
      patch.autoPlayAudioFull = doc.autoPlayAudio ?? DEFAULT_AUTO_PLAY;
    }
    if (doc.languageRepetitionsFull === undefined && doc.languageRepetitions !== undefined) {
      patch.languageRepetitionsFull = doc.languageRepetitions;
    }
    if (doc.languageRepetitionPausesFull === undefined && doc.languageRepetitionPauses !== undefined) {
      patch.languageRepetitionPausesFull = doc.languageRepetitionPauses;
    }
    if (doc.languagePlaybackSpeedsFull === undefined && doc.languagePlaybackSpeeds !== undefined) {
      patch.languagePlaybackSpeedsFull = doc.languagePlaybackSpeeds;
    }
    if (doc.pauseBaseToBaseFull === undefined) {
      patch.pauseBaseToBaseFull = doc.pauseBaseToBase ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
    }
    if (doc.pauseBaseToTargetFull === undefined) {
      patch.pauseBaseToTargetFull = doc.pauseBaseToTarget ?? DEFAULT_PAUSE_BASE_TO_TARGET;
    }
    if (doc.pauseTargetToTargetFull === undefined) {
      patch.pauseTargetToTargetFull = doc.pauseTargetToTarget ?? DEFAULT_PAUSE_BETWEEN_LANGUAGES;
    }
    if (doc.pauseBeforeAutoAdvanceFull === undefined) {
      patch.pauseBeforeAutoAdvanceFull = doc.pauseBeforeAutoAdvance ?? DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE;
    }

    // Freeze today's Practice Listening defaults for existing users (new
    // courses get Listening ON / only-new 1 stamped at insert time in
    // convex/db/courseSettings.ts).
    if (doc.playTargetBeforeBase === undefined) patch.playTargetBeforeBase = false;
    if (doc.playTargetAfterBase === undefined) patch.playTargetAfterBase = true;
    if (doc.targetBeforeOnlyNewReps === undefined) patch.targetBeforeOnlyNewReps = 0; // 0 = ∞ (always)

    return Object.keys(patch).length > 0 ? patch : undefined;
  },
});

/**
 * Apply the translation post-processing step (default: strip trailing '_'
 * runs, see `postProcessTranslation` in lib/languages.ts) to all existing
 * machine-generated translation rows, covering both `translatedText` and the
 * derived `romanizedText` (Buckwalter-style romanizers map '_' through).
 *
 * User-provided rows are skipped. The step only ever applies to machine
 * output, mirroring the write paths.
 *
 * Note this is the one provenance guard that can NOT use the full
 * `mayRegenerateTranslation` rule: `migrateOne` sees the translation row
 * alone, with no `texts` doc to test `userCreated` against. Machine-sourced
 * rows on user-created cards are therefore still normalized here. That is
 * acceptable because the step is punctuation-only. It strips trailing '_'
 * runs and never changes wording, but a migration that rewrites CONTENT must
 * load the text and go through `mayRegenerateTranslation`.
 *
 * Deliberately does NOT touch audio: a trailing-underscore diff is
 * punctuation-only, so existing audio stays valid (the same `soundsSame`
 * rule the live retranslation/edit paths use), and direct patches here
 * trigger no ensure-sweep. `audioRecordings` stores no source text.
 */
export function stripTrailingUnderscoresPatch(
  doc: Pick<
    Doc<'translations'>,
    'targetLanguage' | 'translatedText' | 'romanizedText' | 'translationSource'
  >,
): Partial<Doc<'translations'>> | undefined {
  // Never rewrite human-authored text (user-provided or hand-curated).
  if (isProtectedTranslationSource(doc.translationSource)) {
    return undefined;
  }
  const patch: Partial<Doc<'translations'>> = {};
  const text = postProcessTranslation(doc.targetLanguage, doc.translatedText);
  if (text !== doc.translatedText) patch.translatedText = text;
  // The empty-string "tried, failed" sentinel maps to itself and is left
  // alone; only real romanizations can change.
  if (doc.romanizedText !== undefined) {
    const roman = postProcessTranslation(doc.targetLanguage, doc.romanizedText);
    if (roman !== doc.romanizedText) patch.romanizedText = roman;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export const stripTrailingUnderscores = migrations.define({
  table: 'translations',
  migrateOne: (_ctx, doc) => stripTrailingUnderscoresPatch(doc),
});

/**
 * Safety net for `cards.collectionId` / `cards.collectionOrigin`. The schema
 * comments declare both "backfilled for all existing cards", but the original
 * backfill ran out-of-band and isn't tracked in `runAll`. This makes the
 * guarantee durable. Expected to patch ~0 docs.
 *
 * `collectionId` is recovered via the card's text (`texts.collectionId` is
 * required), `collectionOrigin` from the collection's `origin` with the same
 * `isPremadeLevelCollection` fallback `createCardsFromTexts` uses for legacy
 * CEFR rows.
 *
 * Patching via raw `ctx.db` (the migrations component's path) is aggregate-safe
 * for three of the four card aggregates. They key only on deckId, dueDate and
 * the state label. `cardsByOriginStateAndDueDate` however DOES namespace on
 * `collectionOrigin`, so a raw patch would strand the card's entry in its old
 * namespace with nothing to ever clean it up (`deleteCard` would look under the
 * new origin). `migrateOne` therefore moves the entry itself, in the same
 * transaction as the patch. See the `replaceOrInsert` call below.
 */
export function cardCollectionBackfillPatch(
  card: Pick<Doc<'cards'>, 'collectionId' | 'collectionOrigin'>,
  resolvedCollectionId: Id<'collections'> | undefined,
  collection: Doc<'collections'> | null,
): Partial<Doc<'cards'>> | undefined {
  const patch: Partial<Doc<'cards'>> = {};
  if (card.collectionId === undefined && resolvedCollectionId !== undefined) {
    patch.collectionId = resolvedCollectionId;
  }
  if (card.collectionOrigin === undefined) {
    const origin =
      collection?.origin ??
      (collection && isPremadeLevelCollection(collection)
        ? ('premade' as const)
        : undefined);
    if (origin !== undefined) patch.collectionOrigin = origin;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * The full `migrateOne` body, extracted so it can be exercised against a
 * convex-test db (the migrations component itself isn't registered there,
 * same approach as the other migration suites).
 */
export async function cardCollectionBackfillOne(
  ctx: MutationCtx,
  doc: Doc<'cards'>,
): Promise<Partial<Doc<'cards'>> | undefined> {
  if (doc.collectionId !== undefined && doc.collectionOrigin !== undefined) {
    return undefined;
  }
  const collectionId =
    doc.collectionId ?? (await ctx.db.get(doc.textId))?.collectionId;
  const collection = collectionId ? await ctx.db.get(collectionId) : null;
  const patch = cardCollectionBackfillPatch(doc, collectionId, collection);
  if (!patch) return undefined;

  // `collectionOrigin` is part of the namespace of BOTH origin-keyed
  // aggregates (`cardsByOriginStateAndDueDate` and its writing-track mirror),
  // so their entries have to move with the doc. Only cards aggregated live
  // during the deploy→backfill window actually have one (they land under
  // origin 'none'); for everything else `replaceOrInsert` just inserts under
  // the final origin, which `cardOriginAggregateBackfill` then no-ops over.
  // The writing mirror only holds cards with a seeded writing track, same
  // membership gate `patchCard` uses.
  if (patch.collectionOrigin !== undefined) {
    await cardsByOriginStateAndDueDate.replaceOrInsert(ctx, doc, {
      ...doc,
      ...patch,
    });
    if (hasWritingTrack(doc)) {
      await cardsByOriginWritingStateAndDueDate.replaceOrInsert(ctx, doc, {
        ...doc,
        ...patch,
      });
    }
  }
  return patch;
}

export const cardCollectionBackfill = migrations.define({
  table: 'cards',
  migrateOne: (ctx, doc) => cardCollectionBackfillOne(ctx, doc),
});

/**
 * Full rebuild of `cards.searchableText` via the current
 * `buildCardSearchableText`. Fixes two things at once:
 *
 * 1. CJK/Thai segmentation. Convex's search tokenizer splits only on
 *    whitespace/punctuation, so sentences in languages without word
 *    boundaries (zh/ja/yue/th) were indexed as one giant token and
 *    mid-sentence words could never match. The builder now appends
 *    Intl.Segmenter word tokens.
 * 2. Historically stale rows. Translations/romanizations that landed after
 *    card creation never updated the search string (the review-time check
 *    only compares language sets); going forward the store mutations in
 *    convex/features/decks.ts schedule `rebuildSearchableTextForText`, and
 *    this pass heals everything written before that.
 *
 * Unchanged cards return no patch, so re-runs are cheap. Direct `db.patch`
 * by the component is aggregate-safe: the card aggregates never key on the
 * two fields this migration writes.
 */
export async function rebuildCardSearchableTextPatch(
  ctx: Parameters<typeof buildSearchableTextPatchForCard>[0],
  doc: Doc<'cards'>,
): Promise<Partial<Doc<'cards'>> | undefined> {
  const text = await ctx.db.get(doc.textId);
  if (!text) return undefined;
  // Per-doc cache: migrateOne sees one card at a time, so the deck→languages
  // memo can't span cards here (it does in the live fan-out, which shares one
  // cache across a pagination page).
  return buildSearchableTextPatchForCard(ctx, doc, text, {
    deckLanguages: new Map(),
  });
}

export const rebuildCardSearchableText = migrations.define({
  table: 'cards',
  migrateOne: (ctx, doc) => rebuildCardSearchableTextPatch(ctx, doc),
});

/**
 * Populate the filter-aware `cardsByOriginStateAndDueDate` aggregate for all
 * pre-existing cards. Writes only to the aggregate component (no doc patch),
 * and `insertIfDoesNotExist` makes it idempotent. Cards written live through
 * the `cardAggregates.ts` helpers during the deploy→backfill gap, and cards
 * already inserted by `cardCollectionBackfill`'s `replaceOrInsert`, are simply
 * skipped. Must run after `cardCollectionBackfill` so origins are final.
 *
 * This is what makes `getFilteredCardCounts` stop reading zero for users on a
 * `course` / `custom` content filter, so it runs as early as its dependency
 * allows. Ahead of the much more expensive `rebuildCardSearchableText`.
 */
export const cardOriginAggregateBackfill = migrations.define({
  table: 'cards',
  migrateOne: async (ctx, doc) => {
    await cardsByOriginStateAndDueDate.insertIfDoesNotExist(ctx, doc);
    return undefined;
  },
});

/**
 * Reset Cantonese romanizations produced by the retired `cantonese-romanisation`
 * library (source tag "cantonese-romanisation-v1"). Its dictionary mapped the
 * core vernacular particles (嘅/哋/咗/嘢…) to empty strings. Leaking raw Han
 * characters into the Jyutping line, and picked the first candidate reading
 * with no context, yielding wrong tones (可 → hak1, 去 → heoi2). Clearing
 * `romanizedText` back to the `undefined` "never attempted" state lets the
 * lazy content pipeline regenerate rows on next view via `to-jyutping`.
 *
 * Keyed on LANGUAGE rather than on the retired tag alone: the old library
 * shipped one commit before `romanizationSource` existed (87c6ce9 →
 * 85cd2d5), so rows romanized in that window carry no tag at all and a
 * tag-only filter would skip them forever (the same trap
 * `recomputeRomanizationPatch` documents below). Any Cantonese row whose
 * romanization was NOT produced by the current `to-jyutping` source is
 * cleared. Untagged pre-schema rows, retired-tag rows, and the
 * empty-string "tried, failed" sentinel alike. Rows the lazy pipeline has
 * already regenerated (tagged with the current source, e.g. between deploy
 * and this migration running) are left untouched, as are rows never
 * attempted (`romanizedText === undefined`), simplified Cantonese (`yue`)
 * had romanization disabled, so those all fall in that bucket and the lazy
 * pipeline backfills them now that `needsRomanization` is on.
 */
const RETIRED_CANTONESE_SOURCE = 'cantonese-romanisation-v1';
const CANTONESE_CODES = new Set(['yue', 'yue_traditional']);

export function resetStaleCantoneseRomanizationPatch(doc: {
  language: string;
  romanizedText?: string;
  romanizationSource?: string;
}):
  | { romanizedText: undefined; romanizationSource: undefined }
  | undefined {
  const isRetiredSource = doc.romanizationSource === RETIRED_CANTONESE_SOURCE;
  const isStaleCantonese =
    CANTONESE_CODES.has(doc.language) &&
    doc.romanizedText !== undefined &&
    doc.romanizationSource !== ROMANIZATION_SOURCES.toJyutping;
  if (!isRetiredSource && !isStaleCantonese) return undefined;
  // Patching to undefined unsets both fields → back to "never attempted".
  return { romanizedText: undefined, romanizationSource: undefined };
}

export const resetStaleCantoneseTextRomanization = migrations.define({
  table: 'texts',
  migrateOne: (_ctx, doc) => resetStaleCantoneseRomanizationPatch(doc),
});

export const resetStaleCantoneseTranslationRomanization = migrations.define({
  table: 'translations',
  migrateOne: (_ctx, doc) =>
    resetStaleCantoneseRomanizationPatch({
      language: doc.targetLanguage,
      romanizedText: doc.romanizedText,
      romanizationSource: doc.romanizationSource,
    }),
});

export const recomputeTextRomanization = migrations.define({
  table: 'texts',
  migrateOne: (_ctx, doc) =>
    recomputeRomanizationPatch(doc.language, doc.text, doc.romanizedText),
});

export const recomputeTranslationRomanization = migrations.define({
  table: 'translations',
  migrateOne: (_ctx, doc) =>
    recomputeRomanizationPatch(
      doc.targetLanguage,
      doc.translatedText,
      doc.romanizedText,
    ),
});

/**
 * Recompute Chinese and Korean romanizations in place.
 *
 * All three languages changed romanizer behavior in the same release (see
 * convex/lib/localRomanization.ts):
 *   - `zh` / `zh_traditional`: punctuation, Latin runs and digits were being
 *     silently deleted, and traditional script got context-blind polyphone
 *     readings (銀行 → "yín xíng" rather than "yín háng").
 *   - `ko`: romanized spelling rather than pronunciation (한국말 →
 *     "hangukmal" rather than the standard "hangungmal").
 *
 * Unlike the Cantonese reset above, this RECOMPUTES rather than clearing to
 * `undefined`: `romanizeLocal` is pure, synchronous and network-free, so the
 * corrected value can be written here directly, no scheduler fan-out, no
 * regeneration storm, and every row is correct the moment the migration ends.
 *
 * Deliberately keyed on LANGUAGE, not on `romanizationSource`: rows written
 * before the source field existed carry no tag at all, and a tag-only filter
 * would skip them forever. Recomputing is cheap enough that re-deriving every
 * row in these three languages costs less than reasoning about which are
 * stale. Only rows whose value actually changes are patched, so re-running is
 * a no-op.
 *
 * Scoped to exactly these three codes so it cannot interact with
 * `resetStaleCantonese*Romanization`, which is clearing yue rows in the same
 * `runAll` pass.
 */
const RECOMPUTE_ROMANIZATION_CODES = new Set(['zh', 'zh_traditional', 'ko']);

/**
 * @param sourceText the text the romanization is derived FROM. `texts.text`
 *   for source rows, `translations.translatedText` for translation rows.
 */
export function recomputeRomanizationPatch(
  language: string,
  sourceText: string,
  romanizedText: string | undefined,
): { romanizedText: string; romanizationSource: string } | undefined {
  if (!RECOMPUTE_ROMANIZATION_CODES.has(language)) return undefined;
  // Tri-state contract (schema.ts): `undefined` = never attempted, so leave it
  // for the scheduler to enqueue; `''` = attempted and failed, a sentinel this
  // migration has no new information about. Only rewrite real romanizations.
  if (romanizedText === undefined || romanizedText === '') return undefined;

  const recomputed = romanizeLocal(sourceText, language);
  // `romanizeLocal` returns null only for languages with no local romanizer.
  // Impossible for these three, but never persist a null/empty over good data.
  if (recomputed === null || recomputed === '') return undefined;
  if (recomputed === romanizedText) return undefined;

  return {
    romanizedText: recomputed,
    romanizationSource: getRomanizationSource(language),
  };
}

/**
 * Everything a deploy needs, in order. Completed migrations are skipped.
 *
 * Ordering rationale:
 *  - `cardCollectionBackfill` must precede `cardOriginAggregateBackfill` so
 *    every card is aggregated under its final origin.
 *  - `cardOriginAggregateBackfill` comes next because it is what un-zeroes the
 *    filtered home-screen counts; nothing depends on the searchable-text
 *    rebuild, so that full-table pass goes last.
 *
 * There is deliberately no blanket aggregate rebuild at the end. The only
 * drift it existed to repair. A card aggregated under origin 'none' during
 * the deploy window, then raw-patched to a real origin. Is now handled in
 * `cardCollectionBackfill` itself, which moves the entry in the same
 * transaction as the patch. A per-deck clear + re-insert would have blanked
 * `cardsByStateAndDueDate` (already correct) for the whole userbase
 * mid-session. `migrations/
 * recalcUserCardAggregates.ts` stays available as a per-user repair tool.
 */
export const runAll = migrations.runner([
  internal.migrations.perModeSettingsBackfill,
  internal.migrations.stripTrailingUnderscores,
  internal.migrations.cardCollectionBackfill,
  internal.migrations.cardOriginAggregateBackfill,
  internal.migrations.rebuildCardSearchableText,
  internal.migrations.resetStaleCantoneseTextRomanization,
  internal.migrations.resetStaleCantoneseTranslationRomanization,
  internal.migrations.recomputeTextRomanization,
  internal.migrations.recomputeTranslationRomanization,
]);
