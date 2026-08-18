import { v, ConvexError } from 'convex/values';
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { EVENTS, track } from '../analytics';
import type { Doc, Id } from '../_generated/dataModel';
import {
  requireAuthUserId,
  getAuthUserId,
  getOnboardingProgress,
} from '../db/users';
import {
  PLACEMENT_BATCH_MAX_ATTEMPTS,
  PLACEMENT_BATCH_RETRY_BACKOFF_MS,
  PLACEMENT_CONTENT_BATCH_SIZE,
  PLACEMENT_SENTENCES_QUERY_CAP,
  WARMUP_TRANSLATIONS_MAX_PAIRS_PER_BATCH,
} from '../../lib/constants/onboarding';
import { COLLECTION_PREVIEW_SIZE } from '../lib/collections';
import { getPremadeLevelCollections } from '../db/collections';
import { scheduleMissingTranslationsForText } from './collections';
import { SUPPORTED_LANGUAGES } from '../../lib/languages';
import {
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
} from '../../lib/constants/dailyGoal';
import { getCourseSettings } from '../db/courseSettings';
import { scheduleMissingContent } from './decks';

/**
 * Backend support for the onboarding flow.
 *
 * - `prepareLanguagePair` runs once the user picks (source, target) — it
 *   schedules content warmup so the placement test (and the first real
 *   lesson right after the wizard) can run instantly.
 * - `warmupOnboardingTranslations` is the manually-fired global warm-up
 *   that pre-translates the same content for every language upfront.
 * - `getInitialCardsReadiness` reports how many of the first cards have
 *   content ready — currently unused by the app (the old "customizing"
 *   screen polled it) but kept as a dashboard/debug probe for stuck
 *   onboarding content.
 */

export const prepareLanguagePair = mutation({
  args: {
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { sourceLanguage, targetLanguage }) => {
    const userId = await requireAuthUserId(ctx);
    void userId;

    // Warm up the first few sentences in every level collection so the
    // placement test (which samples across levels) and any subsequent
    // study session start with content ready. The internal action handles
    // its own quota and de-duplication.
    await ctx.scheduler.runAfter(
      0,
      internal.features.collections.ensureFirstSentencesAcrossLevelCollections,
      {
        baseLanguages: [sourceLanguage],
        targetLanguages: [targetLanguage],
      },
    );

    // Schedule a placement-test translation backfill for this target language.
    // This is idempotent — the inner mutation only enqueues missing rows.
    await ctx.scheduler.runAfter(
      0,
      internal.features.onboarding.enqueueMissingPlacementTranslations,
      { targetLanguage, sourceLanguage },
    );

    // Backstop sweep — runs after 60s so most placement translations have
    // had time to land. Re-enqueues TTS for any (translation exists,
    // audio missing) orphan left by an exhausted-retry TTS failure or
    // a claim race. Idempotent.
    await ctx.scheduler.runAfter(
      60_000,
      internal.features.onboarding.ensureAudioForTestTranslations,
      { targetLanguage, sourceLanguage },
    );

    return null;
  },
});

/**
 * Run `scheduleMissingContent` for one batch of placement-test texts.
 *
 * `scheduleMissingContent` handles source-language audio (the text's own
 * language) AND translation enqueueing for every additional language AND the
 * downstream audio trigger via `storeTranslationAndScheduleTTS`, all with
 * idempotent claim/dedupe — so re-entrant batches do reads-only for rows that
 * are already covered. We pass the user's chosen base language as an additional
 * translation target so the placement test can render the source side in that
 * language; `scheduleMissingContent` filters out the text's own language
 * internally, so the no-op case (`sourceLanguage === text.language`) is safe.
 */
async function processPlacementSentences(
  ctx: MutationCtx,
  textIds: Id<'texts'>[],
  targetLanguage: string,
  sourceLanguage: string,
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  let translationsScheduled = 0;
  let audioScheduled = 0;
  for (const textId of textIds) {
    const text = await ctx.db.get(textId);
    if (!text) continue;
    const targetLanguages = Array.from(
      new Set([targetLanguage, sourceLanguage].filter((l) => l !== text.language)),
    );
    const result = await scheduleMissingContent(
      ctx,
      text._id,
      text,
      [text.language],
      targetLanguages,
    );
    translationsScheduled += result.translationsScheduled;
    audioScheduled += result.audioScheduled;
  }
  return { translationsScheduled, audioScheduled };
}

/**
 * Entry point for every placement-test content sweep.
 *
 * Enumerates the corpus once (cheap — only the small `placementTestSentences`
 * rows), processes the first `PLACEMENT_CONTENT_BATCH_SIZE` texts inline, and
 * queues every remaining batch UPFRONT as an independent
 * `processPlacementContentBatch` worker — mirroring the per-collection fan-out
 * in `ensureFirstSentencesAcrossLevelCollections`
 * (`convex/features/collections.ts`). Sweeping the whole corpus inline used to
 * blow past Convex's per-mutation system-op ceiling — each sentence runs the
 * heavy `scheduleMissingContent` (per-language reads, `storage.getUrl` checks,
 * claim inserts, a nested `enqueueTtsJob` mutation, scheduler enqueues), so
 * ~256 sentences × ~20 ops overflowed one transaction.
 *
 * Failure isolation is the reason the batches are queued upfront rather than
 * chained: a throw in the inline page rolls back this whole mutation
 * (including the enqueues), so the awaiting client sees the rejection and can
 * retry; a throw in one scheduled worker rolls back only that batch — every
 * other batch was already enqueued here and runs regardless, and the failed
 * batch reschedules itself with backoff (see `processPlacementContentBatch`).
 * The returned tally covers the INLINE FIRST PAGE ONLY; the scheduled batches
 * report via function logs.
 */
async function runPlacementContentSweep(
  ctx: MutationCtx,
  { targetLanguage, sourceLanguage }: { targetLanguage: string; sourceLanguage: string },
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sentences = await ctx.db
    .query('placementTestSentences')
    .take(PLACEMENT_SENTENCES_QUERY_CAP);
  if (sentences.length === PLACEMENT_SENTENCES_QUERY_CAP) {
    console.warn(
      `placementTestSentences query hit cap ${PLACEMENT_SENTENCES_QUERY_CAP} ` +
        '— raise PLACEMENT_SENTENCES_QUERY_CAP.',
    );
  }

  const tally = await processPlacementSentences(
    ctx,
    sentences.slice(0, PLACEMENT_CONTENT_BATCH_SIZE).map((s) => s.textId),
    targetLanguage,
    sourceLanguage,
  );

  for (
    let i = PLACEMENT_CONTENT_BATCH_SIZE;
    i < sentences.length;
    i += PLACEMENT_CONTENT_BATCH_SIZE
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.onboarding.processPlacementContentBatch,
      {
        textIds: sentences.slice(i, i + PLACEMENT_CONTENT_BATCH_SIZE).map((s) => s.textId),
        targetLanguage,
        sourceLanguage,
      },
    );
  }

  return tally;
}

/**
 * Independent batch worker fanned out by `runPlacementContentSweep` — internal
 * only. Each invocation covers its own fixed slice of the corpus in its own
 * transaction, so one failing batch never affects the others.
 *
 * Convex does not retry scheduled mutations that fail with application
 * errors, so on failure the worker reschedules itself with exponential
 * backoff (up to `PLACEMENT_BATCH_MAX_ATTEMPTS` total attempts) — the error
 * is swallowed on purpose: rethrowing would roll back the transaction
 * *including* the retry enqueue. Retries re-run the full slice; that's safe
 * because `scheduleMissingContent`'s claim/dedupe checks make already-covered
 * rows reads-only. Bounded residual (accepted): a throw between a claim
 * insert and its pool enqueue commits a workId-less claim that blocks
 * re-enqueue until the claim goes stale (`TTS_CLAIM_STALE_MS`), after which
 * a later ensure sweep heals it.
 */
export const processPlacementContentBatch = internalMutation({
  args: {
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
    textIds: v.array(v.id('texts')),
    /** Retry counter — omitted on the initial fan-out, set on reschedules. */
    attempt: v.optional(v.number()),
  },
  returns: v.object({
    translationsScheduled: v.number(),
    audioScheduled: v.number(),
  }),
  handler: async (
    ctx,
    { textIds, targetLanguage, sourceLanguage, attempt = 0 },
  ): Promise<{ translationsScheduled: number; audioScheduled: number }> => {
    try {
      return await processPlacementSentences(
        ctx,
        textIds,
        targetLanguage,
        sourceLanguage,
      );
    } catch (error) {
      if (attempt + 1 < PLACEMENT_BATCH_MAX_ATTEMPTS) {
        console.warn(
          `[processPlacementContentBatch] attempt ${attempt + 1}/${PLACEMENT_BATCH_MAX_ATTEMPTS} ` +
            `failed for ${textIds.length} texts (${sourceLanguage}→${targetLanguage}); retrying`,
          error,
        );
        await ctx.scheduler.runAfter(
          PLACEMENT_BATCH_RETRY_BACKOFF_MS * 2 ** attempt,
          internal.features.onboarding.processPlacementContentBatch,
          { textIds, targetLanguage, sourceLanguage, attempt: attempt + 1 },
        );
      } else {
        console.error(
          `[processPlacementContentBatch] giving up after ${PLACEMENT_BATCH_MAX_ATTEMPTS} attempts ` +
            `for ${textIds.length} texts (${sourceLanguage}→${targetLanguage}) — ` +
            'these placement sentences stay missing content until the next ensure sweep',
          error,
        );
      }
      return { translationsScheduled: 0, audioScheduled: 0 };
    }
  },
});

/**
 * Shared body of `ensurePlacementTranslations` and
 * `enqueueMissingPlacementTranslations`: kick off the batched sweep and
 * report the inline-first-page translation tally as `enqueued`.
 */
async function sweepAndCountEnqueued(
  ctx: MutationCtx,
  langs: { targetLanguage: string; sourceLanguage: string },
): Promise<{ enqueued: number }> {
  const { translationsScheduled } = await runPlacementContentSweep(ctx, langs);
  return { enqueued: translationsScheduled };
}

/**
 * User-callable safety-net: when the placement test renders a card whose
 * translation isn't ready yet, the client invokes this so we can immediately
 * (re-)enqueue any missing placement-test translations for the target
 * language. Idempotent — won't double-enqueue if a claim already exists.
 *
 * Kicks off the batched sweep: processes the first page inline and queues the
 * remaining batches upfront. `enqueued` counts the inline first page only.
 */
export const ensurePlacementTranslations = mutation({
  args: {
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.object({ enqueued: v.number() }),
  handler: async (ctx, { targetLanguage, sourceLanguage }) => {
    const userId = await requireAuthUserId(ctx);
    void userId;
    return sweepAndCountEnqueued(ctx, { targetLanguage, sourceLanguage });
  },
});

/**
 * For every placement-test sentence missing a translation in `targetLanguage`,
 * enqueue an LLM translation job. Audio for the translation is scheduled
 * downstream by the translation pipeline once the row lands.
 *
 * Called from `prepareLanguagePair` for new (target) languages as users sign
 * up, and from the seed migration after the initial English rows are inserted.
 * `enqueued` counts the inline first page only.
 */
export const enqueueMissingPlacementTranslations = internalMutation({
  args: {
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.object({ enqueued: v.number() }),
  handler: async (ctx, { targetLanguage, sourceLanguage }) =>
    sweepAndCountEnqueued(ctx, { targetLanguage, sourceLanguage }),
});

/**
 * Backstop sweep for placement-test content.
 *
 * When `processTTSForCard` exhausts its bounded retries (synthesis API
 * keeps throwing, transcription crashes, storage timeouts), or an LLM
 * translation never lands, the placement-test row stays silently
 * incomplete. Nothing else re-enters `scheduleMissingContent` for those
 * texts afterwards.
 *
 * This covers every placement-test sentence — the first page inline, the rest
 * via the batch workers `runPlacementContentSweep` queues upfront — and
 * re-runs `scheduleMissingContent` for both the source language (English
 * audio) and the target language (translation + downstream audio). All checks
 * inside `scheduleMissingContent` are idempotent — rows that already have
 * translations + audio do nothing but reads.
 *
 * Scheduled 60s after `prepareLanguagePair` so most in-flow translations
 * have had time to land. Also dashboard-callable for re-healing a stuck
 * onboarding; the returned tally covers the inline first page only (the
 * fanned-out batches report via function logs).
 */
export const ensureAudioForTestTranslations = internalMutation({
  args: {
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.object({
    translationsScheduled: v.number(),
    audioScheduled: v.number(),
  }),
  handler: async (ctx, { targetLanguage, sourceLanguage }) =>
    runPlacementContentSweep(ctx, { targetLanguage, sourceLanguage }),
});

/**
 * Manually-fired content warm-up (dashboard / `npx convex run` only — no
 * cron, no in-app caller). Pre-generates TRANSLATIONS ONLY — never audio —
 * for the two text sets a brand-new user hits during onboarding:
 *
 *   1. every `placementTestSentences` text, and
 *   2. the first `COLLECTION_PREVIEW_SIZE` (5) curriculum texts of every
 *      premade level collection,
 *
 * into every requested language. With translations pre-warmed, the wizard's
 * per-user `prepareLanguagePair` sweep finds nothing left to translate and
 * onboarding content is instant; audio stays lazy (generated per-user by the
 * existing pipelines) because it is the dominant cost.
 *
 * `languages` filters the run to individual languages, e.g.
 *   npx convex run features/onboarding:warmupOnboardingTranslations '{"languages":["fr"]}'
 * Omitted → every supported picker-visible language. Unknown codes throw.
 *
 * Idempotent: `scheduleMissingTranslationsForText` skips (text, language)
 * pairs whose translation already exists and is current, and claim-dedupes
 * in-flight jobs, so re-runs are read-only no-ops. Work is fanned out to
 * `warmupTranslationsBatch` workers sized by (texts × languages) so an
 * all-languages run never exceeds one transaction's limits.
 */
export const warmupOnboardingTranslations = internalMutation({
  args: {
    languages: v.optional(v.array(v.string())),
  },
  returns: v.object({
    languages: v.number(),
    texts: v.number(),
    batches: v.number(),
  }),
  handler: async (ctx, args) => {
    const supportedCodes = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
    const languages =
      args.languages !== undefined
        ? args.languages
        : SUPPORTED_LANGUAGES.filter((l) => !l.hiddenFromPicker).map(
          (l) => l.code,
        );
    const unknown = languages.filter((code) => !supportedCodes.has(code));
    if (unknown.length > 0) {
      throw new ConvexError(
        `Unknown language code(s): ${unknown.join(', ')}`,
      );
    }
    if (languages.length === 0) {
      return { languages: 0, texts: 0, batches: 0 };
    }

    const textIds = new Set<Id<'texts'>>();

    const sentences = await ctx.db
      .query('placementTestSentences')
      .take(PLACEMENT_SENTENCES_QUERY_CAP);
    if (sentences.length === PLACEMENT_SENTENCES_QUERY_CAP) {
      console.warn(
        `placementTestSentences query hit cap ${PLACEMENT_SENTENCES_QUERY_CAP} ` +
          '— raise PLACEMENT_SENTENCES_QUERY_CAP.',
      );
    }
    for (const sentence of sentences) {
      textIds.add(sentence.textId);
    }

    const { collections } = await getPremadeLevelCollections(ctx);
    for (const collection of collections) {
      // `userCreated: false` matters: user forks live in the same level
      // collection and would otherwise consume this take() window, paying
      // for private-fork translations while the curriculum texts stay cold.
      const texts = await ctx.db
        .query('texts')
        .withIndex('by_collection_and_userCreated_and_rank', (q) =>
          q.eq('collectionId', collection._id).eq('userCreated', false),
        )
        .order('asc')
        .take(COLLECTION_PREVIEW_SIZE);
      for (const text of texts) {
        textIds.add(text._id);
      }
    }

    const allTextIds = Array.from(textIds);
    const textsPerBatch = Math.max(
      1,
      Math.floor(WARMUP_TRANSLATIONS_MAX_PAIRS_PER_BATCH / languages.length),
    );
    let batches = 0;
    for (let i = 0; i < allTextIds.length; i += textsPerBatch) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.onboarding.warmupTranslationsBatch,
        { textIds: allTextIds.slice(i, i + textsPerBatch), languages },
      );
      batches++;
    }

    console.log(
      `[warmupOnboardingTranslations] fanned out ${batches} batches ` +
        `(${allTextIds.length} texts × ${languages.length} languages)`,
    );
    return {
      languages: languages.length,
      texts: allTextIds.length,
      batches,
    };
  },
});

/**
 * Batch worker fanned out by `warmupOnboardingTranslations` — schedules
 * missing translations (skipTts) for its slice of texts. Same
 * retry-with-backoff shape as `processPlacementContentBatch`: Convex doesn't
 * retry failed scheduled mutations, so the worker reschedules itself and
 * swallows the error (rethrowing would roll back the retry enqueue too).
 */
export const warmupTranslationsBatch = internalMutation({
  args: {
    textIds: v.array(v.id('texts')),
    languages: v.array(v.string()),
    /** Retry counter — omitted on the initial fan-out, set on reschedules. */
    attempt: v.optional(v.number()),
  },
  returns: v.object({ translationsScheduled: v.number() }),
  handler: async (ctx, { textIds, languages, attempt = 0 }) => {
    try {
      let translationsScheduled = 0;
      for (const textId of textIds) {
        const text = await ctx.db.get(textId);
        if (!text) continue;
        translationsScheduled += await scheduleMissingTranslationsForText(
          ctx,
          text,
          languages,
        );
      }
      return { translationsScheduled };
    } catch (error) {
      if (attempt + 1 < PLACEMENT_BATCH_MAX_ATTEMPTS) {
        console.warn(
          `[warmupTranslationsBatch] attempt ${attempt + 1}/${PLACEMENT_BATCH_MAX_ATTEMPTS} ` +
            `failed for ${textIds.length} texts × ${languages.length} languages; retrying`,
          error,
        );
        await ctx.scheduler.runAfter(
          PLACEMENT_BATCH_RETRY_BACKOFF_MS * 2 ** attempt,
          internal.features.onboarding.warmupTranslationsBatch,
          { textIds, languages, attempt: attempt + 1 },
        );
      } else {
        console.error(
          `[warmupTranslationsBatch] giving up after ${PLACEMENT_BATCH_MAX_ATTEMPTS} attempts ` +
            `for ${textIds.length} texts × ${languages.length} languages`,
          error,
        );
      }
      return { translationsScheduled: 0 };
    }
  },
});

/**
 * Final phase of the onboarding wizard.
 *
 *   - Sets `hasCompletedOnboarding = true`.
 *   - Stamps `completedAt` on the `onboardingProgress` row (the row is
 *     kept as the permanent snapshot of the user's onboarding answers;
 *     `getOnboardingProgress` filters frozen rows out so the wizard
 *     can't re-edit them).
 *
 * Nothing is pre-marked into `completedTutorials` anymore: the wizard no
 * longer embeds a tutorial lesson, so the in-app teaching layer (the
 * `home_tour` plus the milestone tips in lib/tutorials/use-milestone-tips.ts)
 * must all stay armed for the fresh user.
 *
 * The course/deck/cards are created by `completeOnboarding`
 * (`convex/features/courses.ts`) right before this runs. For users resuming
 * a row persisted by the old 12-step wizard, the course may predate their
 * final answers — so this mutation re-syncs `dailyTimeGoalMinutes` and the
 * review-mode pick onto the active course's `courseSettings` (idempotent
 * for the normal flow, where `completeOnboarding` already copied them).
 * Keeping the flag-set deferred to this
 * final step means the `OnboardingGuard` redirect logic stays the single
 * source of truth: as long as `hasCompletedOnboarding` is false the user
 * is in onboarding, the wizard resumes from `onboardingProgress.step` on
 * reload, and a back-nav doesn't accidentally flag the user "done".
 *
 * Idempotent: a second call finds no active progress row (the previous
 * call stamped `completedAt`) and skips the row patch; `userSettings`
 * is still patched but the writes are no-ops.
 */
export const finalizeOnboarding = mutation({
  args: {},
  returns: v.object({ alreadyFinalized: v.boolean() }),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);

    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    const alreadyFinalized = settings?.hasCompletedOnboarding === true;

    if (settings) {
      await ctx.db.patch(settings._id, {
        hasCompletedOnboarding: true,
      });
    } else {
      await ctx.db.insert('userSettings', {
        userId,
        hasCompletedOnboarding: true,
      });
    }

    // `getOnboardingProgress` only returns rows where `completedAt` is
    // unset, so a re-entry after completion sees null and the row isn't
    // double-stamped.
    const progress = await getOnboardingProgress(ctx, userId);
    if (progress) {
      await ctx.db.patch(progress._id, { completedAt: Date.now() });

      if (settings?.activeCourseId) {
        const courseSettings = await getCourseSettings(
          ctx,
          settings.activeCourseId,
        );
        if (courseSettings) {
          const patch: Partial<Doc<'courseSettings'>> = {};

          // Sync the wizard's final daily-goal answer onto the active course.
          // Same clamp window as `updateCourseSettings` so a hand-crafted
          // progress write can't smuggle an out-of-range goal past it.
          const goal = progress.dailyTimeGoalMinutes;
          if (typeof goal === 'number' && Number.isFinite(goal)) {
            const clamped = Math.max(
              DAILY_TIME_CUSTOM_MIN,
              Math.min(DAILY_TIME_CUSTOM_MAX, Math.round(goal)),
            );
            if (courseSettings.dailyTimeGoalMinutes !== clamped) {
              patch.dailyTimeGoalMinutes = clamped;
            }
          }

          // Sync the review-mode pick. In the normal flow
          // `completeOnboarding` just copied these, so this is a no-op; it
          // only bites for resumed old-flow rows whose course was created
          // before the mode step.
          if (
            progress.reviewMode !== undefined &&
            courseSettings.reviewMode !== progress.reviewMode
          ) {
            patch.reviewMode = progress.reviewMode;
          }
          // The writing style is derived from `reviewMode`, not from
          // `progress.writingInputMode !== undefined`. Picking Shadowing
          // REMOVES the field (there is no writing input in that mode), so an
          // absent field has to clear courseSettings rather than read as
          // "the user didn't answer" — otherwise a course that already
          // carries 'transcribe' (re-onboarding, or an old-flow row whose
          // course predates the mode step) keeps it and the user silently
          // lands in Transcribe the first time they open Writing mode.
          if (progress.reviewMode !== undefined) {
            const desired =
              progress.reviewMode === 'audio'
                ? undefined
                : progress.writingInputMode;
            if (courseSettings.writingInputMode !== desired) {
              patch.writingInputMode = desired;
            }
          }

          if (Object.keys(patch).length > 0) {
            await ctx.db.patch(courseSettings._id, patch);
          }
        }
      }
    }

    // Server-side so it survives the tab being closed on the redirect to /app.
    // `alreadyFinalized` guards against a double-submit inflating the
    // activation numerator against a client-side event's denominator.
    if (!alreadyFinalized) {
      await track(ctx, userId, EVENTS.ONBOARDING_COMPLETED, {
        acquisition_source: progress?.acquisitionSource,
        learning_goals: progress?.learningGoals,
        daily_time_goal_minutes: progress?.dailyTimeGoalMinutes,
        current_level: progress?.currentLevel,
        base_languages: progress?.baseLanguages,
        target_languages: progress?.targetLanguages,
      });
    }

    return { alreadyFinalized };
  },
});

/**
 * Polled by the customizing-loading screen. Returns counts of how many of the
 * first N cards in the user's active deck have translations + audio ready,
 * so the UI can show progress and gate the next step.
 */
export const getInitialCardsReadiness = query({
  args: { sampleSize: v.optional(v.number()) },
  returns: v.object({
    totalCards: v.number(),
    translatedCards: v.number(),
    audioReadyCards: v.number(),
    sampleSize: v.number(),
  }),
  handler: async (ctx, { sampleSize = 3 }) => {
    // Shared by every not-ready-yet early exit below; never mutated, only
    // serialized on return.
    const emptyReadiness = {
      totalCards: 0,
      translatedCards: 0,
      audioReadyCards: 0,
      sampleSize,
    };

    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return emptyReadiness;
    }

    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const courseId = settings?.activeCourseId;
    if (!courseId) {
      return emptyReadiness;
    }
    const course = await ctx.db.get(courseId);
    if (!course) {
      return emptyReadiness;
    }

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .first();
    if (!deck) {
      return emptyReadiness;
    }

    const cards = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .take(sampleSize);

    // TODO: nested N+1 over (sampleSize × targetLanguages.length). Fine while
    // courses are single-target; if multi-target becomes common, batch the
    // lookups by `textId` IN clauses or denormalise readiness onto cards.
    let translated = 0;
    let audio = 0;
    for (const card of cards) {
      // Translation present for every target language?
      let allTranslated = true;
      let allAudio = true;
      for (const lang of course.targetLanguages) {
        const tr = await ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('targetLanguage', lang),
          )
          .first();
        if (!tr) allTranslated = false;
        const a = await ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('language', lang),
          )
          .first();
        if (!a) allAudio = false;
      }
      if (allTranslated) translated++;
      if (allAudio) audio++;
    }

    return {
      totalCards: cards.length,
      translatedCards: translated,
      audioReadyCards: audio,
      sampleSize,
    };
  },
});
