import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { Doc } from './_generated/dataModel';
import {
  DEFAULT_AUTO_PLAY,
  DEFAULT_PAUSE_BETWEEN_LANGUAGES,
  DEFAULT_PAUSE_BASE_TO_TARGET,
  DEFAULT_PAUSE_BEFORE_AUTO_ADVANCE,
} from '../lib/constants/audioPlayback';
import {
  postProcessTranslation,
  USER_PROVIDED_TRANSLATION_SOURCE,
} from '../lib/languages';
import { buildSearchableTextPatchForCard } from './lib/cardContent';
import type { Id } from './_generated/dataModel';
import { isPremadeLevelCollection } from './lib/collections';
import { cardsByOriginStateAndDueDate } from './db/stats/cardAggregates';

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
 * Deployment does NOT depend on it — writing modes read
 * `*Transcribe ?? *Full ?? <audio field> ?? DEFAULT_*` — but once it has run,
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
 * runs — see `postProcessTranslation` in lib/languages.ts) to all existing
 * machine-generated translation rows, covering both `translatedText` and the
 * derived `romanizedText` (Buckwalter-style romanizers map '_' through).
 *
 * User-provided rows are skipped — the step only ever applies to machine
 * output, mirroring the write paths.
 *
 * Deliberately does NOT touch audio: a trailing-underscore diff is
 * punctuation-only, so existing audio stays valid (the same `soundsSame`
 * rule the live retranslation/edit paths use), and direct patches here
 * trigger no ensure-sweep — `audioRecordings` stores no source text.
 */
export function stripTrailingUnderscoresPatch(
  doc: Pick<
    Doc<'translations'>,
    'targetLanguage' | 'translatedText' | 'romanizedText' | 'translationSource'
  >,
): Partial<Doc<'translations'>> | undefined {
  if (doc.translationSource === USER_PROVIDED_TRANSLATION_SOURCE) {
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
 * backfill ran out-of-band and isn't tracked in `runAll` — this makes the
 * guarantee durable. Expected to patch ~0 docs.
 *
 * `collectionId` is recovered via the card's text (`texts.collectionId` is
 * required), `collectionOrigin` from the collection's `origin` with the same
 * `isPremadeLevelCollection` fallback `createCardsFromTexts` uses for legacy
 * CEFR rows.
 *
 * Patching via raw `ctx.db` (the migrations component's path) is mostly
 * aggregate-safe: three of the card aggregates key only on deckId, dueDate,
 * and the state label. `cardsByOriginStateAndDueDate` however DOES namespace
 * on `collectionOrigin` — this stays safe because this migration runs
 * before `cardOriginAggregateBackfill` in `runAll` (patched cards are
 * inserted with their final origin) and any drift from cards aggregated
 * live during the deploy window is repaired by
 * `recalcCardAggregatesAfterBackfills`, the final step of `runAll`.
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

export const cardCollectionBackfill = migrations.define({
  table: 'cards',
  migrateOne: async (ctx, doc) => {
    if (doc.collectionId !== undefined && doc.collectionOrigin !== undefined) {
      return undefined;
    }
    const collectionId =
      doc.collectionId ?? (await ctx.db.get(doc.textId))?.collectionId;
    const collection = collectionId ? await ctx.db.get(collectionId) : null;
    return cardCollectionBackfillPatch(doc, collectionId, collection);
  },
});

/**
 * Full rebuild of `cards.searchableText` via the current
 * `buildCardSearchableText`. Fixes two things at once:
 *
 * 1. CJK/Thai segmentation — Convex's search tokenizer splits only on
 *    whitespace/punctuation, so sentences in languages without word
 *    boundaries (zh/ja/yue/th) were indexed as one giant token and
 *    mid-sentence words could never match. The builder now appends
 *    Intl.Segmenter word tokens.
 * 2. Historically stale rows — translations/romanizations that landed after
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
 * and `insertIfDoesNotExist` makes it idempotent — cards written live through
 * the `cardAggregates.ts` helpers during the deploy→backfill gap are simply
 * skipped. Must run after `cardCollectionBackfill` so origins are final.
 */
export const cardOriginAggregateBackfill = migrations.define({
  table: 'cards',
  migrateOne: async (ctx, doc) => {
    await cardsByOriginStateAndDueDate.insertIfDoesNotExist(ctx, doc);
    return undefined;
  },
});

/**
 * Final step of the deploy series: self-heal any card-aggregate drift from
 * the deploy→backfill window. A card reviewed after deploy but before
 * `cardCollectionBackfill` gets aggregated under origin `none`; the backfill
 * then raw-patches `collectionOrigin` without moving that entry, leaving an
 * orphan that `deleteCard` would never clean up. Rebuilding per deck (clear +
 * re-insert via the recalc chain, one deck per scheduled mutation) removes
 * any such orphans. Runs last in `runAll`, so both backfills are complete.
 */
export const recalcCardAggregatesAfterBackfills = migrations.define({
  table: 'decks',
  migrateOne: async (ctx, deck) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.recalcUserCardAggregates.processBatch,
      { deckIds: [deck._id], deckIdx: 0 },
    );
    return undefined;
  },
});

/** Everything a deploy needs, in order. Completed migrations are skipped. */
export const runAll = migrations.runner([
  internal.migrations.perModeSettingsBackfill,
  internal.migrations.stripTrailingUnderscores,
  internal.migrations.cardCollectionBackfill,
  internal.migrations.rebuildCardSearchableText,
  internal.migrations.cardOriginAggregateBackfill,
  internal.migrations.recalcCardAggregatesAfterBackfills,
]);
