import { v } from 'convex/values';
import { mutation, query, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  requireAuthUserId,
  getAuthUserId,
  getOnboardingProgress,
} from '../db/users';
import { PLACEMENT_SENTENCES_QUERY_CAP } from '../../lib/constants/onboarding';
import { scheduleMissingContent } from './decks';

/**
 * Backend support for the new onboarding flow.
 *
 * - `prepareLanguagePair` runs once the user picks (source, target) — it
 *   schedules content warmup so the placement test (and the first lesson
 *   that follows) can run instantly.
 * - `getInitialCardsReadiness` is polled by the "Customizing your first
 *   lesson…" step to gate the transition into the first lesson once the
 *   first cards' translations + audio are ready.
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
 * User-callable safety-net: when the placement test renders a card whose
 * translation isn't ready yet, the client invokes this so we can immediately
 * (re-)enqueue any missing placement-test translations for the target
 * language. Idempotent — won't double-enqueue if a claim already exists.
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
    return enqueueMissingPlacementTranslationsImpl(ctx, { targetLanguage, sourceLanguage });
  },
});

/**
 * For every placement-test sentence missing a translation in `targetLanguage`,
 * enqueue an LLM translation job. Audio for the translation is scheduled
 * downstream by the translation pipeline once the row lands.
 *
 * Called from `prepareLanguagePair` for new (target) languages as users sign
 * up, and from the seed migration after the initial English rows are inserted.
 */
export const enqueueMissingPlacementTranslations = internalMutation({
  args: {
    targetLanguage: v.string(),
    sourceLanguage: v.string(),
  },
  returns: v.object({ enqueued: v.number() }),
  handler: async (ctx, args) => enqueueMissingPlacementTranslationsImpl(ctx, args),
});

async function enqueueMissingPlacementTranslationsImpl(
  ctx: import('../_generated/server').MutationCtx,
  { targetLanguage, sourceLanguage }: { targetLanguage: string; sourceLanguage: string },
): Promise<{ enqueued: number }> {
  // Seed migration caps the corpus at ~100 rows. Use `.take()` with an
  // explicit safety bound so a future seed bump fails loudly (warning +
  // capped slice) rather than silently blowing the per-mutation read limit.
  const sentences = await ctx.db
    .query('placementTestSentences')
    .take(PLACEMENT_SENTENCES_QUERY_CAP);
  if (sentences.length === PLACEMENT_SENTENCES_QUERY_CAP) {
    console.warn(
      `placementTestSentences query hit cap ${PLACEMENT_SENTENCES_QUERY_CAP} ` +
        '— batch the lookup or raise PLACEMENT_SENTENCES_QUERY_CAP.',
    );
  }

  // Defer to `scheduleMissingContent` — it handles source-language audio
  // (the text's own language) AND translation enqueueing for every
  // additional language AND the downstream audio trigger via
  // `storeTranslationAndScheduleTTS`, all with idempotent claim/dedupe.
  //
  // We pass the user's chosen base language as an additional translation
  // target so the placement test can render the source side in that
  // language. `scheduleMissingContent` filters out the text's own language
  // internally, so the no-op case (sourceLanguage === text.language) is safe.
  let translationsScheduled = 0;
  for (const s of sentences) {
    const text = await ctx.db.get(s.textId);
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
      { priority: 2 }, // placement test — user is on the screen waiting
    );
    translationsScheduled += result.translationsScheduled;
  }
  return { enqueued: translationsScheduled };
}

/**
 * Backstop sweep for placement-test content.
 *
 * When `processTTSForCard` exhausts its bounded retries (synthesis API
 * keeps throwing, transcription crashes, storage timeouts), or an LLM
 * translation never lands, the placement-test row stays silently
 * incomplete. Nothing else re-enters `scheduleMissingContent` for those
 * texts afterwards.
 *
 * This mutation walks every placement-test sentence and re-runs
 * `scheduleMissingContent` for both the source language (English audio)
 * and the target language (translation + downstream audio). All checks
 * inside `scheduleMissingContent` are idempotent — rows that already have
 * translations + audio do nothing but reads.
 *
 * Scheduled 60s after `prepareLanguagePair` so most in-flow translations
 * have had time to land. Also dashboard-callable for re-healing a stuck
 * onboarding.
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
  handler: async (ctx, args) =>
    ensureAudioForTestTranslationsImpl(ctx, args),
});

async function ensureAudioForTestTranslationsImpl(
  ctx: import('../_generated/server').MutationCtx,
  { targetLanguage, sourceLanguage }: { targetLanguage: string; sourceLanguage: string },
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sentences = await ctx.db
    .query('placementTestSentences')
    .take(PLACEMENT_SENTENCES_QUERY_CAP);
  if (sentences.length === PLACEMENT_SENTENCES_QUERY_CAP) {
    console.warn(
      `[ensureAudioForTestTranslations] hit cap ${PLACEMENT_SENTENCES_QUERY_CAP} — raise it or paginate.`,
    );
  }

  let translationsScheduled = 0;
  let audioScheduled = 0;
  for (const s of sentences) {
    const text = await ctx.db.get(s.textId);
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
      // Critical — user just finished placement and we're patching a hole
      // that already cost them the initial audio.
      { priority: 2 },
    );
    translationsScheduled += result.translationsScheduled;
    audioScheduled += result.audioScheduled;
  }
  return { translationsScheduled, audioScheduled };
}

/**
 * Final phase of the onboarding wizard.
 *
 *   - Sets `hasCompletedOnboarding = true`.
 *   - Pre-marks the in-app driver.js tutorials (`HOME_TOUR`, `FULL_REVIEW_INTRO`,
 *     `AUDIO_REVIEW_INTRO`) complete — the onboarding flow already taught
 *     those mechanics during the embedded first lesson.
 *   - Stamps `completedAt` on the `onboardingProgress` row (the row is
 *     kept as the permanent snapshot of the user's onboarding answers;
 *     `getOnboardingProgress` filters frozen rows out so the wizard
 *     can't re-edit them).
 *
 * The course/deck/cards (and the per-course `dailyTimeGoalMinutes` on
 * `courseSettings`) are created earlier in `completeOnboarding`
 * (`convex/features/courses.ts`). Keeping the flag-set deferred to this
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

    // `home_tour` is intentionally *not* pre-marked — we want it to fire
    // when the user first lands on /app so the top-card learning modes,
    // source selector, and collection picker get explained. The two
    // in-lesson tutorials (`full_review_intro`/`audio_review_intro`) are
    // pre-marked since the embedded first-lesson coachmarks taught the
    // same mechanics already.
    const ONBOARDING_HANDLED_TUTORIALS = [
      'full_review_intro',
      'audio_review_intro',
    ];

    if (settings) {
      const existing = settings.completedTutorials ?? [];
      const merged = Array.from(
        new Set<string>([...existing, ...ONBOARDING_HANDLED_TUTORIALS]),
      );
      await ctx.db.patch(settings._id, {
        hasCompletedOnboarding: true,
        completedTutorials: merged,
      });
    } else {
      await ctx.db.insert('userSettings', {
        userId,
        hasCompletedOnboarding: true,
        completedTutorials: ONBOARDING_HANDLED_TUTORIALS,
      });
    }

    // `getOnboardingProgress` only returns rows where `completedAt` is
    // unset, so a re-entry after completion sees null and the row isn't
    // double-stamped.
    const progress = await getOnboardingProgress(ctx, userId);
    if (progress) {
      await ctx.db.patch(progress._id, { completedAt: Date.now() });
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { totalCards: 0, translatedCards: 0, audioReadyCards: 0, sampleSize };
    }

    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const courseId = settings?.activeCourseId;
    if (!courseId) {
      return { totalCards: 0, translatedCards: 0, audioReadyCards: 0, sampleSize };
    }
    const course = await ctx.db.get(courseId);
    if (!course) {
      return { totalCards: 0, translatedCards: 0, audioReadyCards: 0, sampleSize };
    }

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .first();
    if (!deck) {
      return { totalCards: 0, translatedCards: 0, audioReadyCards: 0, sampleSize };
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
