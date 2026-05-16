import { v } from 'convex/values';
import { mutation, query, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { requireAuthUserId, getAuthUserId } from '../db/users';
import { resolveAudioSpeakerGender } from '../../lib/languages';
import { PLACEMENT_SENTENCES_QUERY_CAP } from '../../lib/constants/onboarding';

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
  if (targetLanguage === sourceLanguage) return { enqueued: 0 };

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

  let enqueued = 0;
  for (const s of sentences) {
    const text = await ctx.db.get(s.textId);
    if (!text) continue;

    // Skip if translation already exists.
    const existing = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', text._id).eq('targetLanguage', targetLanguage),
      )
      .first();
    if (existing) continue;

    // Skip if a job is already in-flight (claim row exists).
    const claim = await ctx.db
      .query('llmTranslationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', text._id).eq('targetLanguage', targetLanguage),
      )
      .first();
    if (claim) continue;

    await ctx.db.insert('llmTranslationClaims', {
      textId: text._id,
      targetLanguage,
      claimedAt: Date.now(),
    });

    // Seeded by textId so concurrent placement-translation enqueues for
    // the same sentence pick the same gender (same fix as decks.ts —
    // prevents an audio-regen loop later).
    const audioSpeakerGender = resolveAudioSpeakerGender(text.speakerGender, text._id);

    await ctx.scheduler.runAfter(
      0,
      internal.features.llmTranslationQueue.enqueueLlmTranslation,
      {
        args: {
          textId: text._id,
          sourceLanguage,
          targetLanguage,
          text: text.text,
          audioSpeakerGender,
        },
        priority: 1, // user-facing, prioritize over background
      },
    );
    enqueued++;
  }
  return { enqueued };
}

/**
 * Final phase of the onboarding wizard.
 *
 *   - Sets `hasCompletedOnboarding = true`.
 *   - Pre-marks the in-app driver.js tutorials (`HOME_TOUR`, `FULL_REVIEW_INTRO`,
 *     `AUDIO_REVIEW_INTRO`) complete — the onboarding flow already taught
 *     those mechanics during the embedded first lesson.
 *   - Deletes the `onboardingProgress` row.
 *
 * The course/deck/cards are created earlier in `completeOnboarding`
 * (`convex/features/courses.ts`). Keeping the flag-set deferred to this
 * final step means the `OnboardingGuard` redirect logic stays the single
 * source of truth: as long as `hasCompletedOnboarding` is false the user
 * is in onboarding, the wizard resumes from `onboardingProgress.step` on
 * reload, and a back-nav doesn't accidentally flag the user "done".
 *
 * Idempotent: safe to call when progress is already gone or the flag is
 * already true.
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

    const progress = await ctx.db
      .query('onboardingProgress')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (progress) {
      await ctx.db.delete(progress._id);
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
