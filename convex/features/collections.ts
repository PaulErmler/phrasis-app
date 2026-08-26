import { v, ConvexError } from 'convex/values';
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server';
import { query, mutation, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import {
  getPremadeLevelCollections,
  getCollectionProgress,
  getNextTextsFromRank,
} from '../db/collections';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import {
  applyMarkCounterDelta,
  collectionTextMarkValidator,
  counterDeltaForMark,
  getMark,
  listMarksForCollection,
  MARK_READ_LIMIT,
} from '../db/collectionTextMarks';
import {
  buildTextContentBatchForLanguages,
  getCourseLanguages,
} from '../lib/cardContent';
import {
  scheduleMissingContent,
  scheduleTranslationForLanguage,
  scheduleAudioForLanguage,
} from '../lib/contentScheduling';
import {
  isCollectionAccessible,
  requireAccessibleText,
} from '../lib/collectionAccess';
import {
  COLLECTION_PREVIEW_SIZE,
  MAX_PREVIEW_PAGE_SIZE,
  canUserAccessCollectionText,
  isPremadeLevelCollection,
} from '../lib/collections';
import {
  isTranslationVersionStale,
  resolveCardSpeakerGenders,
} from '../../lib/languages';
import {
  missingAnnotationKinds,
  TEXT_ANNOTATIONS,
} from '../lib/textAnnotations';
import { mayRegenerateTranslation } from '../../lib/translationProvenance';
import { deleteAudioRow } from '../lib/audio';
import { resolveAudioPayload } from '../lib/audioAssets';
import { hasActiveTtsClaim } from './ttsProcessing';
import { getLlmClaim, isClaimFresh } from './llmTranslationQueue';
import {
  translationValidator,
  audioRecordingValidator,
  type LlmPriority,
} from '../types';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

// The accessibility predicates were historically defined (and exported) here;
// they now live in convex/lib/collectionAccess.ts so features/decks.ts can
// share them without importing this module (which formed the backend's only
// import cycle). Re-exported to keep this module's public surface stable.
export {
  isCollectionAccessible,
  requireAccessibleText,
} from '../lib/collectionAccess';

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Paginated browse of a collection's sentences for the preview dialog.
 *
 * The client snapshots the sequential frontier
 * (`collectionProgress.lastRankProcessed`) once when the dialog opens and
 * passes it as `anchorRank` on every request, so the range NEVER shifts
 * while the dialog is open. Rows are returned with their live status and no
 * server-side filtering. A row the user adds or ignores mid-session flips
 * to 'added'/'ignored' in place (the client decides visibility) instead of
 * vanishing from the page. Reopening the dialog captures a fresh anchor,
 * which is what makes the session's green/grey rows disappear.
 *
 * - `direction: 'after'`: ranks > anchor, ascending: the main stream (the
 *   not-yet-added zone plus this session's activity). The user's marked
 *   texts at/below the anchor are injected at the top of the first page
 *   (rank-ordered) so passed-over ignored/prioritized sentences stay
 *   visible and manageable.
 * - `direction: 'upTo'`: ranks ≤ anchor, DESCENDING: the added-history
 *   feed the "show added" toggle reveals above the list, paged further as
 *   the user scrolls up.
 *
 * Each row carries `missingTranslationLanguages`. The client batches those
 * into `requestPreviewTranslations` as pages are revealed. Audio is never
 * generated here; rows expose whatever exists (`requestPreviewAudio` handles
 * the on-click generation).
 */
export const browseCollectionTexts = query({
  args: {
    collectionId: v.id('collections'),
    anchorRank: v.number(),
    direction: v.union(v.literal('after'), v.literal('upTo')),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      _id: v.id('texts'),
      text: v.string(),
      sourceLanguage: v.string(),
      collectionRank: v.number(),
      status: v.union(
        v.literal('added'),
        v.literal('prioritized'),
        v.literal('ignored'),
        v.literal('none'),
      ),
      // This query opts into markVersionStale, so non-source-language
      // entries additionally carry `versionStale` (see the tri-state note
      // on CardTranslationContent in convex/lib/cardContent.ts).
      translations: v.array(
        translationValidator.extend({ versionStale: v.optional(v.boolean()) }),
      ),
      audioRecordings: v.array(audioRecordingValidator),
      missingTranslationLanguages: v.array(v.string()),
      needsAnnotationBackfill: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const emptyPage = { page: [], isDone: true, continueCursor: '' };
    const userId = await getAuthUserId(ctx);
    if (!userId) return emptyPage;

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return emptyPage;
    const { course } = active;

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return emptyPage;
    }

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.max(
        1,
        Math.min(args.paginationOpts.numItems, MAX_PREVIEW_PAGE_SIZE),
      ),
    };

    const isAfter = args.direction === 'after';
    const result = isLevelCollection
      ? await ctx.db
          .query('texts')
          .withIndex('by_collection_and_userCreated_and_rank', (q) => {
            const base = q
              .eq('collectionId', args.collectionId)
              .eq('userCreated', false);
            return isAfter
              ? base.gt('collectionRank', args.anchorRank)
              : base.lte('collectionRank', args.anchorRank);
          })
          .order(isAfter ? 'asc' : 'desc')
          .paginate(paginationOpts)
      : await ctx.db
          .query('texts')
          .withIndex('by_collection_and_userId_and_rank', (q) => {
            const base = q
              .eq('collectionId', args.collectionId)
              .eq('userId', userId);
            return isAfter
              ? base.gt('collectionRank', args.anchorRank)
              : base.lte('collectionRank', args.anchorRank);
          })
          .order(isAfter ? 'asc' : 'desc')
          .paginate(paginationOpts);

    // First page of the main stream: surface the user's marked texts that
    // sit at/below the anchor (the scan passed over them; the range above
    // won't reach them). Bounded to MARK_READ_LIMIT injected rows total.
    // Mark counts are user-writable and uncapped, and every injected row
    // costs a text read + card/mark point-reads + full content assembly, so
    // an unbounded injection would blow Convex's per-execution read limits.
    let injectedTexts: Doc<'texts'>[] = [];
    if (isAfter && args.paginationOpts.cursor === null && args.anchorRank > 0) {
      const markTypes = ['ignored', 'prioritized', 'readd'] as const;
      const perType = await Promise.all(
        markTypes.map((mark) =>
          listMarksForCollection(
            ctx,
            userId,
            course._id,
            args.collectionId,
            mark,
            {
              maxRank: args.anchorRank,
              limit: MARK_READ_LIMIT,
            },
          ),
        ),
      );
      const markDocs = perType
        .flat()
        .sort((a, b) => a.collectionRank - b.collectionRank)
        .slice(0, MARK_READ_LIMIT);
      const texts = await Promise.all(
        markDocs.map((m) => ctx.db.get(m.textId)),
      );
      injectedTexts = texts.filter((t): t is Doc<'texts'> => t !== null);
    }

    const combined = [...injectedTexts, ...result.page];

    const deck = await getDeckByCourseId(ctx, course._id);
    const [cards, marks] = await Promise.all([
      Promise.all(
        combined.map((t) =>
          deck
            ? getCardByDeckAndText(ctx, deck._id, t._id)
            : Promise.resolve(null),
        ),
      ),
      Promise.all(combined.map((t) => getMark(ctx, userId, course._id, t._id))),
    ]);

    // No server-side filtering. Every row ships with its status and the
    // client decides visibility (session persistence + the show-added /
    // show-ignored toggles are pure client concerns).
    const rows = combined.map((text, i) => ({
      text,
      card: cards[i],
      mark: marks[i],
    }));

    const inputs = rows.map((row, i) => ({
      key: String(i),
      textId: row.text._id,
      sourceText: row.text.text,
      sourceLanguage: row.text.language,
      sourceRomanization: row.text.romanizedText ?? undefined,
      sourceIpa: row.text.ipaText ?? undefined,
      sourceFurigana: row.text.furiganaText ?? undefined,
      userCreated: row.text.userCreated,
    }));
    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      course.baseLanguages,
      course.targetLanguages,
      { markVersionStale: true },
    );

    const page = rows.map((row, i) => {
      const content = contentMap.get(String(i))!;
      // Version-stale rows count as missing too: the client then routes them
      // through requestPreviewTranslations, which regenerates them, so
      // browsing already upgrades translations to the current version
      // instead of deferring the delete+regen to the card-add sweep. The
      // stale text still ships in `translations` for display until the
      // regenerated row lands. `versionStale` already carries the full
      // `mayRegenerateTranslation` gate (user-created texts never report
      // stale), so there is nothing to re-check here.
      const missingTranslationLanguages = content.translations
        .filter(
          (tr) =>
            tr.language !== row.text.language &&
            (!tr.text || tr.versionStale === true),
        )
        .map((tr) => tr.language);
      // Rows whose translations are all present can still be missing an
      // annotation (romanization after an engine swap, IPA on rows predating
      // the feature). The client's requestPreviewTranslations batching keys
      // off `missingTranslationLanguages`, so without this flag those rows
      // were never requested and the annotation gap stayed visible forever
      // in the preview. Projected values mirror the stored tri-state for
      // course languages, so `=== undefined` (via missingAnnotationKinds)
      // honours the '' failure sentinel here too.
      const needsAnnotationBackfill =
        missingAnnotationKinds(row.text.language, row.text).length > 0 ||
        content.translations.some(
          (tr) =>
            tr.language !== row.text.language &&
            tr.text.length > 0 &&
            missingAnnotationKinds(tr.language, {
              romanizedText: tr.romanization,
              ipaText: tr.ipa,
              furiganaText: tr.furigana,
            }).length > 0,
        );
      return {
        _id: row.text._id,
        text: row.text.text,
        sourceLanguage: row.text.language,
        collectionRank: row.text.collectionRank,
        // 'readd' is internal bookkeeping (un-marked below the frontier,
        // waiting for the drain), the client sees it as a plain unmarked row.
        status: (row.card
          ? 'added'
          : row.mark?.mark === 'readd'
            ? 'none'
            : (row.mark?.mark ?? 'none')) as
          | 'added'
          | 'prioritized'
          | 'ignored'
          | 'none',
        translations: content.translations,
        audioRecordings: content.audioRecordings,
        missingTranslationLanguages,
        needsAnnotationBackfill,
      };
    });

    return { ...result, page };
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Set (or clear, with `mark: null`) the user's browse mark on a text.
 * 'prioritized' texts are drained first by addCardsFromCollection;
 * 'ignored' texts are skipped by it and count toward collection completion.
 * Counter deltas land on the same collectionProgress row in the same
 * transaction, so `remaining = textCount - cardsAdded - ignoredCount` is
 * always O(1)-consistent.
 */
export const setCollectionTextMark = mutation({
  args: {
    textId: v.id('texts'),
    mark: v.union(collectionTextMarkValidator, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    // Full access chain, without the scope check, prioritizing another
    // user's fork text would later make the drain add it to this user's deck.
    const { text } = await requireAccessibleText(
      ctx,
      args.textId,
      courseId,
      userId,
    );

    // Marks exist only for texts that aren't cards yet. The preview hides
    // these buttons on added rows; this guards direct calls.
    const deck = await getDeckByCourseId(ctx, courseId);
    if (deck) {
      const card = await getCardByDeckAndText(ctx, deck._id, args.textId);
      if (card)
        throw new ConvexError({
          code: 'INVALID_STATE',
          message: 'Text is already in the deck',
        });
    }

    const existing = await getMark(ctx, userId, courseId, args.textId);
    const prev = existing?.mark ?? null;
    if (prev === args.mark) return null;
    // A 'readd' row already means "unmarked, back in the queue", clearing it
    // again is a no-op (the row must survive so the drain can still reach the
    // text; it renders as 'none' either way).
    if (prev === 'readd' && args.mark === null) return null;

    if (args.mark === null) {
      if (!existing) return null; // unreachable (prev === null early-returns)
      const progress = await getCollectionProgress(
        ctx,
        userId,
        courseId,
        text.collectionId,
      );
      if ((progress?.lastRankProcessed ?? 0) >= text.collectionRank) {
        // The scan already passed this rank; deleting the row would strand
        // the text (injection only surfaces marked texts and the scan never
        // looks backwards). Flip it to the internal 'readd' mark instead: it
        // stays visible via the browse injection and is drained like
        // 'prioritized' by the next add. The frontier stays monotonic, so
        // no rescan of the added stretch and no browseAnchor regression.
        await ctx.db.patch(existing._id, { mark: 'readd' });
      } else {
        await ctx.db.delete(existing._id);
      }
    } else {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      await ctx.db.insert('collectionTextMarks', {
        userId,
        courseId,
        collectionId: text.collectionId,
        textId: args.textId,
        mark: args.mark,
        collectionRank: text.collectionRank,
      });
    }
    await applyMarkCounterDelta(ctx, userId, courseId, text.collectionId, {
      ...(prev ? counterDeltaForMark(prev, -1) : {}),
      ...(args.mark ? { [args.mark]: 1 } : {}),
    });
    return null;
  },
});

/**
 * Schedule skipTts translation jobs for every course language this text is
 * missing OR whose stored translation is version-stale (regenerated in place,
 * with the same exemptions and claim deferrals as scheduleMissingContent's
 * sweep). Resolves + persists speaker gender BEFORE translating (same as
 * scheduleMissingContent) so the translation's grammar agrees with the voice
 * that will eventually read it, otherwise the gender sweep would invalidate
 * these rows the moment audio is generated. Shared by the on-reveal and
 * prewarm preview-generation mutations.
 *
 * `opts.llmPriority` tiers the translation enqueues. A parameter rather than a
 * constant because the preview paths that share this function are user-facing:
 * only the onboarding warmup passes 'background'.
 */
export async function scheduleMissingTranslationsForText(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  languages: string[],
  opts?: { llmPriority?: LlmPriority },
): Promise<number> {
  const { audioSpeakerGender, genderPatch } = resolveCardSpeakerGenders(
    text,
    text._id,
  );
  if (Object.keys(genderPatch).length > 0) {
    await ctx.db.patch(text._id, genderPatch);
  }
  // Backfill missing annotations (romanization, IPA) for the source text.
  // Same `=== undefined` test as the card sweep. The empty-string sentinel
  // means "tried and failed", and re-running it would burn the retries again
  // on every page reveal.
  for (const kind of missingAnnotationKinds(text.language, text)) {
    await ctx.scheduler.runAfter(0, TEXT_ANNOTATIONS[kind].sourceTextAction, {
      textId: text._id,
      text: text.text,
      language: text.language,
    });
  }

  let scheduled = 0;
  for (const lang of languages) {
    if (lang === text.language) continue;
    const existing = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', text._id).eq('targetLanguage', lang),
      )
      .first();
    let preferredRegionVariant: string | undefined;
    if (existing) {
      // Version-stale rows regenerate here too, so browsing a collection
      // already upgrades its translations to the current version, otherwise
      // the card-add sweep (scheduleMissingContent) deletes exactly what the
      // preview just showed. Shares that sweep's provenance gate so the two
      // can't disagree about what is regenerable.
      const isStale =
        mayRegenerateTranslation(text, existing) &&
        isTranslationVersionStale(lang, existing.translationVersion);
      if (!isStale) {
        // The translation is current, but an annotation may not exist. A row
        // can reach that state through an engine swap, which resets the
        // value to `undefined` so the new implementation refills it, or (for
        // IPA) by predating the feature. The only backfill used to be in
        // `scheduleMissingContent`, which the preview never runs (preview
        // rows are usually not cards), so those rows rendered with a bare
        // annotation gap until the text was added to a deck. Mirrors that
        // sweep's loop in decks.ts.
        for (const kind of missingAnnotationKinds(lang, existing)) {
          await ctx.scheduler.runAfter(
            0,
            TEXT_ANNOTATIONS[kind].translationAction,
            {
              textId: text._id,
              text: existing.translatedText,
              language: lang,
            },
          );
        }
        continue;
      }
      // Mirror the sweep's deferrals: never delete under an active TTS claim
      // (races the pending audio write) or a fresh LLM claim (the in-flight
      // retranslation overwrites the row anyway).
      if (await hasActiveTtsClaim(ctx, text._id, lang)) continue;
      const llmClaim = await getLlmClaim(ctx, text._id, lang);
      if (llmClaim && isClaimFresh(llmClaim)) {
        continue;
      }
      // Keep mixed-dialect rows on their pinned dialect across regeneration.
      preferredRegionVariant = existing.regionVariant;
      await ctx.db.delete(existing._id);
      // The old audio was synthesized from the deleted wording. Drop it so
      // the new translation can't pair with mismatched audio (reference-aware,
      // like the card sweep's delete).
      const staleAudio = await ctx.db
        .query('audioRecordings')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', text._id).eq('language', lang),
        )
        .first();
      if (staleAudio) {
        await deleteAudioRow(ctx, staleAudio);
      }
    }
    if (
      await scheduleTranslationForLanguage(ctx, text, lang, {
        audioSpeakerGender,
        preferredRegionVariant,
        skipTts: true,
        // Warm work. If the landing translation still triggers TTS (a card
        // references the text, see storeTranslationAndScheduleTTS's skipTts
        // docs), that audio rides the background pool.
        priority: 'background',
        llmPriority: opts?.llmPriority,
      })
    ) {
      scheduled++;
    }
  }
  return scheduled;
}

/**
 * Generate missing translations (NO audio) for up to MAX_PREVIEW_PAGE_SIZE
 * texts of a collection. Called by the preview as pages are revealed.
 * Dedup comes from the existing per-(textId, language) claims, so re-calls
 * while jobs are in flight are cheap no-ops. Deliberately not quota-gated:
 * translations are the cheap part; audio (the dominant cost) only happens on
 * an explicit audio-icon click or once a text becomes a card. Also
 * deliberately not gated by `assertBillingCurrent` while past due (decided
 * 2026-07-26), same rationale as ensureCardContent in decks.ts: the
 * pipeline self-heals content, and enforcement lives at the consumeQuota
 * spend boundary plus the app-wide overdue dialog.
 */
export const requestPreviewTranslations = mutation({
  args: {
    collectionId: v.id('collections'),
    textIds: v.array(v.id('texts')),
  },
  returns: v.object({ translationsScheduled: v.number() }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return { translationsScheduled: 0 };
    }
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) return { translationsScheduled: 0 };

    const textIds = args.textIds.slice(0, MAX_PREVIEW_PAGE_SIZE);
    const languages = getCourseLanguages(
      course.baseLanguages,
      course.targetLanguages,
    );

    let translationsScheduled = 0;
    for (const textId of textIds) {
      const text = await ctx.db.get(textId);
      if (
        !text ||
        text.collectionId.toString() !== args.collectionId.toString()
      ) {
        continue;
      }
      if (!canUserAccessCollectionText(collection, text, userId)) {
        continue;
      }
      translationsScheduled += await scheduleMissingTranslationsForText(
        ctx,
        text,
        languages,
      );
    }

    return { translationsScheduled };
  },
});

/**
 * Prewarm the NEXT page of translations (NO audio): schedules skipTts
 * translation jobs for the next MAX_PREVIEW_PAGE_SIZE texts after `afterRank`
 * in rank order. The client calls this whenever a page finishes loading
 * (dialog open included), so by the time the user clicks "show more" the next
 * page's translations are usually already stored and the rows render
 * instantly. Claim-deduped like all preview generation; never quota-gated.
 */
export const prewarmPreviewTranslations = mutation({
  args: {
    collectionId: v.id('collections'),
    afterRank: v.number(),
  },
  returns: v.object({ translationsScheduled: v.number() }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return { translationsScheduled: 0 };
    }

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      args.afterRank,
      MAX_PREVIEW_PAGE_SIZE,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );
    const languages = getCourseLanguages(
      course.baseLanguages,
      course.targetLanguages,
    );

    let translationsScheduled = 0;
    for (const text of texts) {
      translationsScheduled += await scheduleMissingTranslationsForText(
        ctx,
        text,
        languages,
      );
    }

    return { translationsScheduled };
  },
});

/**
 * Generate audio for ONE (text, language), the preview's audio-icon click.
 * No-ops when the audio already exists or a TTS claim is in flight; returns
 * `scheduled: false` when the language's translation hasn't landed yet (the
 * client keeps the spinner and the reactive page query delivers the URL when
 * TTS completes). Free, like the regular ensure path. The click is the cost
 * control.
 */
export const requestPreviewAudio = mutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);

    const { text } = await requireAccessibleText(
      ctx,
      args.textId,
      course._id,
      userId,
    );
    const courseLanguages = new Set([
      text.language,
      ...course.baseLanguages,
      ...course.targetLanguages,
    ]);
    if (!courseLanguages.has(args.language)) {
      throw new ConvexError({
        code: 'INVALID_LANGUAGES',
        message: 'Language not in course',
      });
    }

    const existingAudio = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (existingAudio) {
      // A row only counts as "audio exists" if it still resolves to a
      // playable blob. A dangling pointer. Asset row deleted, or asset
      // present but its blob gone, otherwise wedges the preview
      // permanently: this mutation would return `scheduled: false` forever
      // while `buildTextContentBatchForLanguages` hands the client a null
      // url, so the button can neither play nor regenerate. The card sweep
      // (`scheduleMissingContent`) is the only other place that clears these,
      // and the preview never runs it. Preview rows are usually not cards.
      // Mirrors that sweep's checks in convex/features/decks.ts.
      const payload = await resolveAudioPayload(ctx, existingAudio);
      const url = payload ? await ctx.storage.getUrl(payload.storageId) : null;
      if (url !== null) return { scheduled: false };
      // Don't race an in-flight job: `processTTSForCard` attaches its row
      // before the blob is necessarily resolvable, and deleting it here
      // would make the completing job patch a row that no longer exists.
      if (await hasActiveTtsClaim(ctx, args.textId, args.language)) {
        return { scheduled: false };
      }
      // Reference-aware: a shared asset survives while other texts point at
      // it. `blobAlreadyGone` skips the storage delete we already know failed.
      await deleteAudioRow(ctx, existingAudio, { blobAlreadyGone: true });
    }

    const { audioSpeakerGender, genderPatch } = resolveCardSpeakerGenders(
      text,
      args.textId,
    );
    if (Object.keys(genderPatch).length > 0) {
      await ctx.db.patch(args.textId, genderPatch);
    }

    const translation =
      args.language === text.language
        ? null
        : await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', args.textId).eq('targetLanguage', args.language),
            )
            .first();
    if (args.language !== text.language && !translation) {
      // Translation still generating. The click raced it. Nothing to
      // synthesize yet; the client retries once the translation row lands.
      return { scheduled: false };
    }

    const scheduled = await scheduleAudioForLanguage(
      ctx,
      text,
      args.language,
      audioSpeakerGender,
      translation,
    );
    return { scheduled };
  },
});

/**
 * Ensure translations and audio exist for the FIRST 5 sentences of every
 * premade level collection in the active dataset (or legacy CEFR set) for
 * the given language pair. Scheduled from course creation
 * (`createCourse` / `completeOnboarding`) so that drilling into any level
 * later doesn't show a loading spinner.
 *
 * Internal because the only callers are the two course-creation paths,
 * which already know the course's language arrays, no auth lookup needed.
 *
 * Independent of user progress (unlike `ensureContentForCollection` which
 * paginates from `lastRankProcessed`), always starts at collectionRank 1.
 *
 * Fans out one scheduled `ensureFirstSentencesForCollection` mutation per
 * level collection so each child runs in its own transaction; the inline
 * version exceeded Convex's per-mutation wallclock limit (~15s) once the
 * dataset grew to ~20 levels × 5 texts × multi-language storage.getUrl checks.
 */
export const ensureFirstSentencesAcrossLevelCollections = internalMutation({
  args: {
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.object({
    scheduledCollections: v.number(),
  }),
  handler: async (ctx, args) => {
    // Load only the ~20 premade level collections via indexed lookups so this
    // doesn't scan every user's custom/chat collections (which share the
    // table), see getPremadeLevelCollections for the read pattern.
    const { collections: levelCollections } =
      await getPremadeLevelCollections(ctx);

    await Promise.all(
      levelCollections.map((collection) =>
        ctx.scheduler.runAfter(
          0,
          internal.features.collections.ensureFirstSentencesForCollection,
          {
            collectionId: collection._id,
            baseLanguages: args.baseLanguages,
            targetLanguages: args.targetLanguages,
          },
        ),
      ),
    );

    return { scheduledCollections: levelCollections.length };
  },
});

/**
 * Per-collection child of `ensureFirstSentencesAcrossLevelCollections`.
 *
 * Idempotent. `scheduleMissingContent` skips any (textId, language) already
 * covered, so re-entries do reads only and write nothing. Processes the 5
 * texts in parallel; safe because each text writes only to its own
 * (textId, language)-keyed rows (audio patches, claim inserts, per-text
 * scheduler calls).
 */
export const ensureFirstSentencesForCollection = internalMutation({
  args: {
    collectionId: v.id('collections'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const texts = await ctx.db
      .query('texts')
      .withIndex('by_collection_and_rank', (q) =>
        q.eq('collectionId', args.collectionId),
      )
      .order('asc')
      .take(COLLECTION_PREVIEW_SIZE);

    await Promise.all(
      texts.map((text) =>
        scheduleMissingContent(
          ctx,
          text._id,
          text,
          args.baseLanguages,
          args.targetLanguages,
          // Signup-time warm of ~20 collections × 5 texts: background, so
          // this burst can't queue ahead of the user's own cards.
          { priority: 'background' },
        ),
      ),
    );
    return null;
  },
});
