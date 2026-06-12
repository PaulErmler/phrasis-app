import { v, ConvexError } from 'convex/values';
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  internalAction,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import { insertCard } from '../db/stats/cardAggregates';
import {
  getVoiceForLanguage,
  getVoiceForLanguageVariant,
  getVoiceGenderByApiCode,
  resolveAudioSpeakerGender,
  getTtsProviderForLanguage,
  getTranslationConfigForLanguage,
  resolveMixedVariant,
} from '../../lib/languages';
import {
  getCourseSettings,
  setActiveCollectionOnSettings,
} from '../db/courseSettings';
import { getAuthUserId, requireAuthUserId, getUserSettings } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import {
  findNextIncompleteCollection,
  getActiveDataset,
  getCollectionProgress as getCollectionProgressHelper,
  getNextCollection,
  getNextTextsFromRank,
} from '../db/collections';
import { translateText, romanizeText } from './translation';
import { getRomanizationSource } from '../lib/localRomanization';
import {
  GOOGLE_TRANSLATE_SOURCE,
  ROMANIZATION_LANGUAGES,
  USER_PROVIDED_TRANSLATION_SOURCE,
} from '../../lib/languages';
import { shouldOverwriteProvider } from '../../lib/ttsPrecedence';
import {
  translationValidator,
  audioRecordingValidator,
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
  asVoiceGender,
  type SchedulingMode,
} from '../types';
import { claimTtsIfAvailable, hasActiveTtsClaim } from './ttsProcessing';
import { languageSupportsStt } from '../../lib/languages';
import {
  claimLlmTranslationIfAvailable,
  CLAIM_STALE_MS as LLM_CLAIM_STALE_MS,
} from './llmTranslationQueue';
import { buildTextContentBatchForLanguages, buildCardSearchableText } from '../lib/cardContent';
import {
  CONTENT_LOOKAHEAD_SIZE,
  LEGACY_LEVEL_ORDER,
  isPremadeLevelCollection,
} from '../lib/collections';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import { consumeQuota, checkQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { MAX_CARDS_PER_BATCH, ENSURE_CONTENT_LOOKAHEAD } from '../../lib/constants/learning';
import { isCollectionAccessible } from './collections';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Schedule missing translations and audio for a text.
 *
 * Used by both `prepareCardContent` (for new cards) and
 * `ensureCardContent` (for on-demand regeneration).
 */
export async function scheduleMissingContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
  options?: { priority?: 0 | 1 | 2 },
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  // Default to 0 (normal). Priority tiers: 2 = critical (onboarding seed /
  // placement test — the user is blocked on this content right now),
  // 1 = active collection (foreground drilling, lookahead, retranslation),
  // 0 = background warmup (cross-level first-5 prewarm, opportunistic sync).
  const priority = options?.priority ?? 0;
  const sourceLanguage = text.language;

  // Resolve gender for both the voice (audioSpeakerGender) and the translation
  // prompt's <speaker_gender> tag (read from text.speakerGender). They must
  // agree on the grammatical gender for the audio voice to match the
  // translation grammar; otherwise we hit the user-facing "voice is the
  // opposite gender" bug.
  //
  // `speakerGender` is the definitive answer for what `audioSpeakerGender`
  // should be — when it's `'male'`/`'female'`, audio mirrors it. The two
  // fields diverge in semantics for `'neutral'`/undefined:
  //
  //   - Custom sentences (`userCreated === true`): `speakerGender` is owned
  //     by the LLM metadata pipeline (`generateSentenceMetadata`). A `'neutral'`
  //     verdict means the LLM looked at every supplied translation and found
  //     no morphology that forces a gender — overwriting that with a
  //     coin-flipped `'male'`/`'female'` would force gendered grammar where
  //     none is appropriate. So we preserve `speakerGender` as-is and only
  //     resolve `audioSpeakerGender` (the voice still has to be one of
  //     `'male'`/`'female'`).
  //
  //   - Pre-made dataset sentences (`userCreated === false`): no LLM gender
  //     analysis ever runs, so `speakerGender` is always undefined unless a
  //     future dataset/curator sets it. We coin-flip a definitive gender
  //     (deterministic per textId) and write it to BOTH fields so the
  //     translation prompt and the audio voice agree. If a future dataset
  //     does set `speakerGender` to `'male'`/`'female'`, the first branch
  //     below honors it.
  let audioSpeakerGender: 'male' | 'female';
  const genderPatch: {
    speakerGender?: 'male' | 'female';
    audioSpeakerGender?: 'male' | 'female';
  } = {};

  if (text.speakerGender === 'male' || text.speakerGender === 'female') {
    // Definitive (LLM for custom, dataset for pre-made if ever set).
    // Source of truth — never overwrite; mirror into audioSpeakerGender.
    audioSpeakerGender = text.speakerGender;
    if (text.audioSpeakerGender !== audioSpeakerGender) {
      genderPatch.audioSpeakerGender = audioSpeakerGender;
    }
  } else if (text.userCreated) {
    // Custom + neutral/undefined: preserve the LLM's call on `speakerGender`,
    // only resolve `audioSpeakerGender`. Prior coin-flip preserved when
    // present so two runs don't disagree; else seeded by textId so the
    // resolution is deterministic and stable across retries.
    audioSpeakerGender =
      text.audioSpeakerGender === 'male' || text.audioSpeakerGender === 'female'
        ? text.audioSpeakerGender
        : resolveAudioSpeakerGender(text.speakerGender, textId);
    if (text.audioSpeakerGender !== audioSpeakerGender) {
      genderPatch.audioSpeakerGender = audioSpeakerGender;
    }
  } else {
    // Pre-made + neutral/undefined: coin-flip BOTH fields to the same value
    // so the translation prompt's <speaker_gender> tag and the audio voice
    // agree. Prior `audioSpeakerGender` preserved when present so the
    // resolution doesn't re-roll between runs.
    audioSpeakerGender =
      text.audioSpeakerGender === 'male' || text.audioSpeakerGender === 'female'
        ? text.audioSpeakerGender
        : resolveAudioSpeakerGender(undefined, textId);
    if (text.speakerGender !== audioSpeakerGender) {
      genderPatch.speakerGender = audioSpeakerGender;
    }
    if (text.audioSpeakerGender !== audioSpeakerGender) {
      genderPatch.audioSpeakerGender = audioSpeakerGender;
    }
  }

  if (Object.keys(genderPatch).length > 0) {
    await ctx.db.patch(textId, genderPatch);
  }

  // Always include the text's own language (`sourceLanguage`) so the
  // source-language branch below queues audio for it regardless of what
  // the caller passed in `baseLanguages`. Without this, a user whose
  // course uses an English VARIANT (`en_gb` / `en_us` / `en_au`) would
  // never get audio for `en` curriculum + placement-test texts —
  // `allRequiredLanguages` wouldn't contain `'en'`, so the
  // `lang === sourceLanguage` branch never fires. Same shape applies to
  // any other text where the user's variant differs from the text's
  // actual language code (`es` vs `es_latam`, etc.). The Set dedupes
  // when `baseLanguages`/`targetLanguages` already contain the source.
  const allRequiredLanguages = [
    ...new Set([sourceLanguage, ...baseLanguages, ...targetLanguages]),
  ];

  // Languages that need translation (all except source). `sourceLanguage`
  // is in `allRequiredLanguages` by construction above; filtering it out
  // here ensures we don't enqueue a self-translation for it.
  const langsNeedingTranslation = allRequiredLanguages.filter(
    (l) => l !== sourceLanguage,
  );

  // Batch load existing translations, audio, AND LLM claims for the
  // needed languages — all three sets in one Promise.all so the read
  // round-trips run in parallel rather than serially inside the loop
  // below. The claim lookup gates whether `scheduleMissingContent`
  // should defer a TTS enqueue while an LLM retranslation is in flight;
  // doing it per-language inline turned a fast O(languages) read into
  // a serial chain that pushed the mutation past Convex's 1s budget
  // when called from a batched caller like `ensureContentForCollection`.
  const [existingTranslations, existingAudio, existingLlmClaims] =
    await Promise.all([
      Promise.all(
        langsNeedingTranslation.map((lang) =>
          ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', textId).eq('targetLanguage', lang),
            )
            .first(),
        ),
      ),
      Promise.all(
        allRequiredLanguages.map((lang) =>
          ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', textId).eq('language', lang),
            )
            .first(),
        ),
      ),
      Promise.all(
        langsNeedingTranslation.map((lang) =>
          ctx.db
            .query('llmTranslationClaims')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', textId).eq('targetLanguage', lang),
            )
            .first(),
        ),
      ),
    ]);

  // Build lookup maps
  const translationMap = new Map(
    langsNeedingTranslation.map((lang, i) => [lang, existingTranslations[i]]),
  );
  const audioMap = new Map(
    allRequiredLanguages.map((lang, i) => [lang, existingAudio[i]]),
  );
  const llmClaimMap = new Map(
    langsNeedingTranslation.map((lang, i) => [lang, existingLlmClaims[i]]),
  );

  // Tracks languages whose audio was found to have drifted gender, so the
  // translation sweep below can also invalidate the legacy translation row
  // (the one without a stamped `speakerGender`) that was generated alongside
  // the now-stale audio. See the sweep comment for full rationale.
  const langsWithAudioGenderDrift = new Set<string>();

  // Validate storage files — delete stale rows where the file was removed.
  // Do not delete while TTS is in flight: `processTTSForCard` may have inserted
  // a row whose URL is not yet resolvable, or concurrent cleanup would remove
  // the row while later validation updates expect it to exist (silent no-op).
  for (const [lang, audio] of audioMap) {
    if (audio?.storageId) {
      const url = await ctx.storage.getUrl(audio.storageId);
      if (url === null) {
        if (await hasActiveTtsClaim(ctx, textId, lang)) {
          continue;
        }
        await ctx.db.delete(audio._id);
        audioMap.set(lang, null);
      } else {
        // Prefer the persisted gender; fall back to curated-list lookup for
        // legacy rows written before voiceGender existed.
        const storedGender =
          audio.voiceGender ?? getVoiceGenderByApiCode(audio.voiceName);
        // Unknown gender is itself a regenerate trigger — we can't trust the
        // audio to match the card's speakerGender, so rebuild it.
        const genderMismatch =
          storedGender === undefined ||
          ((audioSpeakerGender === 'male' || audioSpeakerGender === 'female') &&
            storedGender !== audioSpeakerGender);
        // Rows predating this field are legacy Google audio; treat as 'google'.
        const existingProvider = audio.ttsProvider ?? 'google';
        const currentProvider = getTtsProviderForLanguage(lang);
        // Provider regen is now gated by lib/ttsPrecedence.ts — only the
        // (current, existing) matchups listed there force a delete + re-synth
        // (e.g. google now overwrites azure, to migrate the Arabic dialects
        // off Azure). Unlisted pairs keep the existing audio.
        const providerMismatch = shouldOverwriteProvider(
          currentProvider,
          existingProvider,
        );
        if (genderMismatch) {
          langsWithAudioGenderDrift.add(lang);
        }
        if (genderMismatch || providerMismatch) {
          await ctx.storage.delete(audio.storageId);
          await ctx.db.delete(audio._id);
          audioMap.set(lang, null);
        }
      }
    }
  }

  // Invalidate translations whose recorded gender no longer matches the card's
  // current `audioSpeakerGender`. Two cases trigger deletion:
  //
  //  1. Post-PR drift: `translation.speakerGender` is stamped and disagrees
  //     with `audioSpeakerGender`. The card flipped gender (custom-chat path
  //     when the metadata LLM lands a definitive gender that overrides the
  //     initial coin-flip; or any future code path that updates the field)
  //     after the translation was written.
  //
  //  2. Legacy drift: `translation.speakerGender` is undefined (row written
  //     before the field existed) AND the matching audio was just flagged as
  //     gender-drifted by the validity loop above. Audio drift is the
  //     retrospective signal that the translation alongside it was almost
  //     certainly generated under a gender that's now wrong. Without this,
  //     the audio loop heals the voice but the translation text — produced
  //     with the wrong grammar — survives and gets stamped as if correct by
  //     the "fill if missing" path, so the user ends up hearing the right
  //     voice reading wrong-grammar text.
  //
  // Legacy rows without an audio drift signal are left alone — we have no
  // evidence they're wrong, and a blanket invalidation would cause a regen
  // storm across the database.
  //
  // User-provided translations are skipped unconditionally — the user picked
  // the wording (and implicitly the gender) themselves.
  //
  // Skip when TTS is in flight: deleting now would race the pending write
  // and leave an audio row pointing at no translation. Defer to the next
  // `scheduleMissingContent` pass.
  for (const [lang, translation] of translationMap) {
    if (!translation) continue;
    if (translation.translationSource === USER_PROVIDED_TRANSLATION_SOURCE) continue;

    const isLegacy = translation.speakerGender === undefined;
    const isDrifted = !isLegacy && translation.speakerGender !== audioSpeakerGender;
    const isLegacyAlongsideDriftedAudio = isLegacy && langsWithAudioGenderDrift.has(lang);

    if (!isDrifted && !isLegacyAlongsideDriftedAudio) continue;
    if (await hasActiveTtsClaim(ctx, textId, lang)) continue;

    await ctx.db.delete(translation._id);
    translationMap.set(lang, null);
    // Audio for the legacy-alongside-drifted case was already deleted by the
    // validity loop. The block below only fires when the sweep itself owns
    // the delete — i.e. post-PR drift where the audio looked fine to the
    // validity loop (correct voiceGender) but the translation row was
    // produced under a stale `text.speakerGender`.
    const staleAudio = audioMap.get(lang);
    if (staleAudio?.storageId) {
      await ctx.storage.delete(staleAudio.storageId);
      await ctx.db.delete(staleAudio._id);
      audioMap.set(lang, null);
    }
  }

  let translationsScheduled = 0;
  let audioScheduled = 0;

  /** Schedule a Scribe backfill for an existing audio row that lacks timings. */
  const scheduleTimingsBackfillIfNeeded = async (lang: string) => {
    const audio = audioMap.get(lang);
    if (!audio || !audio.storageId || audio.wordTimings) return;
    // Languages without STT support (e.g. `el` — Azure Fast Transcription
    // can't transcribe `el-GR`) will never get word timings, so don't waste
    // a claim on a backfill that's guaranteed to no-op.
    if (!languageSupportsStt(lang)) return;
    const claimed = await claimTtsIfAvailable(ctx, textId, lang);
    if (!claimed) return;
    // Forward the persisted regionVariant for mixed-dialect rows so STT runs
    // against the same locale the voice was synthesized in. Undefined for
    // non-mixed languages and for the source-language (no translations row).
    const regionVariant = translationMap.get(lang)?.regionVariant;
    await ctx.scheduler.runAfter(
      0,
      internal.features.ttsProcessing.backfillWordTimings,
      { textId, language: lang, storageId: audio.storageId, regionVariant },
    );
  };

  // Schedule romanization for source text if needed and missing.
  // `=== undefined` (not `!x`) so the empty-string sentinel that
  // `processRomanizationForSourceText` writes after 3 failed retries is
  // honored — without that distinction every ensureContent call would burn
  // another 3 retries against the same failing input.
  if (
    ROMANIZATION_LANGUAGES.has(sourceLanguage) &&
    text.romanizedText === undefined
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.decks.processRomanizationForSourceText,
      { textId, text: text.text, language: sourceLanguage },
    );
  }

  // Schedule missing content for each required language
  for (const lang of allRequiredLanguages) {
    const hasAudio = audioMap.get(lang) != null;

    if (lang === sourceLanguage) {
      // Source language — no translation needed, maybe TTS
      if (!hasAudio) {
        const claimed = await claimTtsIfAvailable(ctx, textId, lang);
        if (claimed) {
          const voiceName = getVoiceForLanguage(lang, audioSpeakerGender);
          const voiceGender = getVoiceGenderByApiCode(voiceName);
          if (voiceGender === undefined) {
            throw new Error(
              `Cannot enqueue TTS: voice "${voiceName}" for language "${lang}" is not in the curated voice list.`,
            );
          }
          await ctx.runMutation(
            internal.features.ttsProcessing.enqueueTtsJob,
            {
              provider: getTtsProviderForLanguage(lang),
              args: {
                textId,
                text: text.text,
                language: lang,
                voiceName,
                voiceGender,
                speed: 1,
              },
              priority,
            },
          );
          audioScheduled++;
        }
      } else {
        await scheduleTimingsBackfillIfNeeded(lang);
      }
    } else {
      // Different language — need translation
      const translation = translationMap.get(lang);
      if (!translation) {
        // Route to either the LLM queue or the legacy Google path based on
        // the per-language config in lib/languages.ts. Both paths terminate
        // by writing the `translations` row via storeTranslationAndScheduleTTS,
        // so downstream (romanization, TTS) doesn't care which provider ran.
        const tCfg = getTranslationConfigForLanguage(lang);
        if (tCfg.provider === 'openrouter') {
          const claimed = await claimLlmTranslationIfAvailable(ctx, textId, lang);
          if (claimed) {
            await ctx.runMutation(
              internal.features.llmTranslationQueue.enqueueLlmTranslation,
              {
                args: {
                  textId,
                  sourceLanguage,
                  targetLanguage: lang,
                  text: text.text,
                  audioSpeakerGender,
                },
                priority,
              },
            );
            translationsScheduled++;
          }
        } else {
          // Legacy Google Translate path — priority carries through to the
          // downstream TTS enqueue via storeTranslationAndScheduleTTS.
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.processTranslationForCard,
            {
              textId,
              sourceLanguage,
              targetLanguage: lang,
              text: text.text,
              audioSpeakerGender,
              priority,
            },
          );
          translationsScheduled++;
        }
      } else {
        // Translation exists — backfill romanization if missing
        // `=== undefined` (not `!x`) so the empty-string "tried, failed,
        // leave empty" sentinel persisted by `processRomanizationForTranslation`
        // is respected on subsequent ensureContent runs.
        if (
          ROMANIZATION_LANGUAGES.has(lang) &&
          translation.romanizedText === undefined
        ) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.processRomanizationForTranslation,
            { textId, translatedText: translation.translatedText, language: lang },
          );
        }
        if (!hasAudio) {
          // Defer TTS while an LLM retranslation is in flight for this
          // (textId, lang). Without this guard, `flagTranslation` (which
          // deletes audio + enqueues an LLM retranslation) races with a
          // concurrent `scheduleMissingContent` that would otherwise see
          // "translation exists, audio missing" and enqueue TTS against
          // the OLD `translation.translatedText` — producing stale audio
          // just before the new translation lands. The LLM worker's
          // `storeTranslationAndScheduleTTS` will enqueue TTS for the new
          // text once the LLM completes. The claim was pre-fetched in
          // the batched Promise.all above; no per-iteration DB read here.
          const existingLlmClaim = llmClaimMap.get(lang) ?? null;
          const llmRetranslationInFlight =
            existingLlmClaim !== null &&
            Date.now() - existingLlmClaim.claimedAt < LLM_CLAIM_STALE_MS;
          if (llmRetranslationInFlight) {
            // Skip — the LLM worker owns the next TTS enqueue for this row.
          } else {
            const claimed = await claimTtsIfAvailable(ctx, textId, lang);
            if (claimed) {
              // For mixed-dialect rows, prefer a voice in the same locale that
              // was picked at translation time and forward the variant to TTS
              // so the validation roundtrip uses the matching STT locale.
              const regionVariant = translation.regionVariant;
              const voiceName = regionVariant
                ? getVoiceForLanguageVariant(lang, regionVariant, audioSpeakerGender)
                : getVoiceForLanguage(lang, audioSpeakerGender);
              const voiceGender = getVoiceGenderByApiCode(voiceName);
              if (voiceGender === undefined) {
                throw new Error(
                  `Cannot enqueue TTS: voice "${voiceName}" for language "${lang}" is not in the curated voice list.`,
                );
              }
              await ctx.runMutation(
                internal.features.ttsProcessing.enqueueTtsJob,
                {
                  provider: getTtsProviderForLanguage(lang),
                  args: {
                    textId,
                    text: translation.translatedText,
                    language: lang,
                    voiceName,
                    voiceGender,
                    speed: 1,
                    regionVariant,
                  },
                  priority,
                },
              );
              audioScheduled++;
            }
          }
        } else {
          await scheduleTimingsBackfillIfNeeded(lang);
        }
      }
    }
  }

  return { translationsScheduled, audioScheduled };
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get cards in the user's deck with translations and audio (paginated).
 *
 * Each card includes a `hasMissingContent` flag. If true, the frontend should
 * call `ensureCardContent` to trigger regeneration.
 */
export const getDeckCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('cards'),
      _creationTime: v.number(),
      textId: v.id('texts'),
      sourceText: v.string(),
      sourceLanguage: v.string(),
      translations: v.array(translationValidator),
      audioRecordings: v.array(audioRecordingValidator),
      dueDate: v.number(),
      isMastered: v.boolean(),
      isHidden: v.boolean(),
      isFavorite: v.optional(v.boolean()),
      hasMissingContent: v.boolean(),
      audioSpeedOverrides: v.optional(v.record(v.string(), v.number())),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return [];

    const maxCards = args.limit ?? 20;
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .take(maxCards);

    const texts = await Promise.all(cards.map((c) => ctx.db.get(c.textId)));

    const inputs = cards
      .map((card, i) => {
        const text = texts[i];
        if (!text) return null;
        return {
          key: String(i),
          textId: card.textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceRomanization: text.romanizedText ?? undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      course.baseLanguages,
      course.targetLanguages,
    );

    const result = cards.map((card, i) => {
      const text = texts[i];
      if (!text) return null;
      const content = contentMap.get(String(i));
      if (!content) return null;

      return {
        _id: card._id,
        _creationTime: card._creationTime,
        textId: card.textId,
        sourceText: text.text,
        sourceLanguage: text.language,
        translations: content.translations,
        audioRecordings: content.audioRecordings,
        dueDate: card.dueDate,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite ?? false,
        hasMissingContent: content.hasMissingContent,
        audioSpeedOverrides: card.audioSpeedOverrides,
      };
    });

    return result.filter(
      (card): card is NonNullable<typeof card> => card !== null,
    );
  },
});

/**
 * Get collection progress for all collections in the active course.
 */
export const getCollectionProgress = query({
  args: {},
  returns: v.array(
    v.object({
      collectionId: v.id('collections'),
      collectionName: v.string(),
      cardsAdded: v.number(),
      totalTexts: v.number(),
      order: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const settings = await getUserSettings(ctx, userId);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;

    // Fetch only the premade rows actually displayed: the active dataset's ~20
    // collections (one indexed scan) or the seven legacy CEFR rows by name.
    // Avoids loading every user's custom/chat collections on this query.
    const activeDataset = await getActiveDataset(ctx);
    let collections: Doc<'collections'>[];
    if (activeDataset) {
      collections = await ctx.db
        .query('collections')
        .withIndex('by_datasetId_and_order', (q) =>
          q.eq('datasetId', activeDataset._id),
        )
        .collect();
    } else {
      const legacyDocs = await Promise.all(
        LEGACY_LEVEL_ORDER.map((name) =>
          ctx.db
            .query('collections')
            .withIndex('by_name', (q) => q.eq('name', name))
            .first(),
        ),
      );
      collections = legacyDocs.filter(
        (c): c is Doc<'collections'> => c !== null,
      );
    }

    const result = await Promise.all(
      collections.map(async (collection) => {
        const progress = await getCollectionProgressHelper(
          ctx,
          userId,
          courseId,
          collection._id,
        );

        return {
          collectionId: collection._id,
          collectionName: collection.name,
          cardsAdded: progress?.cardsAdded ?? 0,
          totalTexts: collection.textCount,
          order: collection.order,
        };
      }),
    );

    // Sort by `order` when present (new dataset), else by legacy CEFR position.
    // Items with `order` set always sort before legacy items to keep new
    // dataset on top once it's loaded.
    const legacyPosition = (name: string) => {
      const idx = LEGACY_LEVEL_ORDER.indexOf(name as (typeof LEGACY_LEVEL_ORDER)[number]);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    result.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return legacyPosition(a.collectionName) - legacyPosition(b.collectionName);
    });

    return result;
  },
});

/**
 * Get the next N texts from a collection that haven't been added to the deck yet.
 * Uses collectionProgress.lastRankProcessed for efficient pagination.
 */
export const getNextTextsFromCollection = query({
  args: {
    collectionId: v.id('collections'),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('texts'),
      text: v.string(),
      collectionRank: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const settings = await getUserSettings(ctx, userId);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;

    if (!(await isCollectionAccessible(ctx, args.collectionId, courseId))) {
      return [];
    }

    const maxTexts = Math.min(args.limit ?? 5, 20);

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      maxTexts,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );

    return texts.map((t) => ({
      _id: t._id,
      text: t.text,
      collectionRank: t.collectionRank,
    }));
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Set the active collection for the user's current course.
 */
export const setActiveCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) throw new ConvexError('Collection not found');

    const isLevelCollection = isPremadeLevelCollection(collection);
    if (!isLevelCollection) {
      const courseSettings = await getCourseSettings(ctx, courseId);
      const isChatCollection =
        courseSettings?.chatCollectionId?.toString() === args.collectionId.toString();
      const isCustomCollection = (courseSettings?.activeCustomCollectionIds ?? []).some(
        (id) => id.toString() === args.collectionId.toString(),
      );
      if (!isChatCollection && !isCustomCollection) {
        throw new ConvexError('Collection not accessible');
      }
    }

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      args.collectionId,
    );

    if (progress && progress.cardsAdded >= collection.textCount) {
      throw new ConvexError('This collection is already complete');
    }

    await setActiveCollectionOnSettings(ctx, courseId, args.collectionId);
    return null;
  },
});

/**
 * Toggle a custom collection's selection for automatic card inclusion.
 */
export const toggleCustomCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    selected: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) throw new ConvexError('Collection not found');

    const isLevelCollection = isPremadeLevelCollection(collection);
    if (isLevelCollection) {
      throw new ConvexError('Cannot toggle a level collection');
    }

    const courseSettings = await getCourseSettings(ctx, courseId);

    const isChatCollection =
      courseSettings?.chatCollectionId?.toString() === args.collectionId.toString();
    const isCustomCollection =
      courseSettings?.customCollectionId?.toString() === args.collectionId.toString();
    const isAlreadyCustom = (courseSettings?.activeCustomCollectionIds ?? []).some(
      (id) => id.toString() === args.collectionId.toString(),
    );
    if (!isChatCollection && !isCustomCollection && !isAlreadyCustom) {
      throw new ConvexError('Collection not accessible');
    }

    const currentIds = courseSettings?.activeCustomCollectionIds ?? [];
    const idStr = args.collectionId.toString();
    const isCurrentlySelected = currentIds.some((id) => id.toString() === idStr);

    const newIds = isCurrentlySelected
      ? currentIds.filter((id) => id.toString() !== idStr)
      : [...currentIds, args.collectionId];

    if (courseSettings) {
      await ctx.db.patch(courseSettings._id, {
        activeCustomCollectionIds: newIds,
      });
    } else {
      await ctx.db.insert('courseSettings', {
        courseId,
        initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
        activeCustomCollectionIds: newIds,
      });
    }

    return { selected: !isCurrentlySelected };
  },
});

/**
 * Creates cards from a list of texts and returns count of new cards inserted.
 * Shared by both chat-collection and difficulty-collection card creation.
 */
export async function createCardsFromTexts(
  ctx: MutationCtx,
  texts: Doc<'texts'>[],
  deck: Doc<'decks'>,
  collectionId: Id<'collections'>,
  course: Doc<'courses'>,
): Promise<{ cardsInserted: number; newLastRank: number }> {
  const now = Date.now();
  let cardsInserted = 0;
  let newLastRank = 0;

  // Look up the source collection's origin once per batch so each inserted
  // card carries the denormalized field for the content-source filter.
  // Fall back to `isPremadeLevelCollection` for legacy CEFR collections
  // (pre-OGTE-cutover rows that have neither a `datasetId` nor an explicit
  // `legacy: true` flag and never got their `origin` backfilled) — otherwise
  // cards inserted from them get `collectionOrigin: undefined` and never
  // match the 'course' filter even though the UI treats them as course content.
  const collection = await ctx.db.get(collectionId);
  const collectionOrigin: 'premade' | 'custom' | 'chat' | undefined =
    collection?.origin
    ?? (collection && isPremadeLevelCollection(collection) ? 'premade' : undefined);

  for (const text of texts) {
    if (text.collectionRank > newLastRank) {
      newLastRank = text.collectionRank;
    }

    const existingCard = await getCardByDeckAndText(ctx, deck._id, text._id);

    if (!existingCard) {
      const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
      const { searchableText, searchableTextLanguages } =
        await buildCardSearchableText(ctx, text._id, text.text, courseLanguages);

      await insertCard(ctx, {
        deckId: deck._id,
        textId: text._id,
        collectionId,
        collectionOrigin,
        dueDate: now + cardsInserted,
        isMastered: false,
        isHidden: false,
        isFavorite: false,
        isGraduated: false,
        schedulingPhase: 'preReview' as const,
        preReviewCount: 0,
        radioRoundCounter: 0,
        radioPlayCount: 0,
        // Random tiebreak so that even brand-new cards inserted in a single
        // batch (which would otherwise share creation time + counter) end up
        // in a shuffled radio order rather than insertion order.
        radioOrderKey: Math.floor(Math.random() * 0x7fffffff),
        searchableText,
        searchableTextLanguages,
      });
      cardsInserted++;
    }
  }

  return { cardsInserted, newLastRank };
}

/**
 * Updates collection progress after adding cards.
 */
export async function updateCollectionProgress(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  textsProcessed: number,
  newLastRank: number,
): Promise<void> {
  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collectionId,
  );

  if (progress) {
    await ctx.db.patch(progress._id, {
      cardsAdded: progress.cardsAdded + textsProcessed,
      lastRankProcessed: Math.max(progress.lastRankProcessed ?? 0, newLastRank),
    });
  } else {
    await ctx.db.insert('collectionProgress', {
      userId,
      courseId,
      collectionId,
      cardsAdded: textsProcessed,
      lastRankProcessed: newLastRank,
    });
  }
}

/**
 * Add cards from a collection to the user's deck.
 * Chat-collection texts are prioritized before the difficulty collection.
 */
export const addCardsFromCollection = mutation({
  args: {
    collectionId: v.id('collections'),
    batchSize: v.number(),
    /** When true, only add from this specific collection — skip custom collection mixing. */
    exclusive: v.optional(v.boolean()),
  },
  returns: v.object({
    cardsAdded: v.number(),
    totalCardsInDeck: v.number(),
  }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const clampedBatchSize = Math.max(1, Math.min(MAX_CARDS_PER_BATCH, Math.floor(args.batchSize)));

    // Get or create deck
    let deck = await getDeckByCourseId(ctx, courseId);
    if (!deck) {
      const deckId = await ctx.db.insert('decks', {
        courseId,
        name: `Learning ${course.targetLanguages.join(', ')}`,
        cardCount: 0,
      });
      deck = await ctx.db.get(deckId);
      if (!deck) throw new ConvexError('Failed to create deck');
    }

    let totalCardsInserted = 0;
    let totalTextsProcessed = 0;
    let remainingBatch = clampedBatchSize;

    // --- Phase 1: Add from custom collection(s) ---
    // When the requested collection is a level collection (learning mode auto-add),
    // drain pending texts from ALL selected custom collections randomly.
    // When the requested collection is a custom collection (collection detail "add" button),
    // only add from that specific collection.
    const courseSettings = await getCourseSettings(ctx, courseId);
    const activeCollectionId = courseSettings?.activeCollectionId;
    // Snapshot whether each prepareCardContent we schedule below should be
    // marked high-priority. Comparing by `===` is enough since both sides are
    // Convex Id strings (or undefined).
    const priorityForCollection = (collectionId: Id<'collections'>): 0 | 1 | 2 =>
      activeCollectionId && activeCollectionId === collectionId ? 1 : 0;
    const requestedCollection = await ctx.db.get(args.collectionId);
    const isLevelCollection = requestedCollection
      ? isPremadeLevelCollection(requestedCollection)
      : false;

    // Content-source filter: scopes the learning-mode auto-add flow only.
    // When `exclusive` is set, the user is explicitly adding from a specific
    // collection via the collection detail dialog — honor that source directly.
    const studyContentFilter = courseSettings?.studyContentFilter ?? 'both';
    const skipCustomSources = !args.exclusive && studyContentFilter === 'course';
    const skipPremadeSource = !args.exclusive && studyContentFilter === 'custom';

    const customCollectionIdsToProcess: Id<'collections'>[] = skipCustomSources
      ? []
      : args.exclusive
        ? (isLevelCollection
          ? []
          : [args.collectionId])
        : isLevelCollection
          ? (courseSettings?.activeCustomCollectionIds ?? [])
          : [args.collectionId].filter((id) =>
            courseSettings?.chatCollectionId?.toString() === id.toString() ||
            courseSettings?.customCollectionId?.toString() === id.toString() ||
            (courseSettings?.activeCustomCollectionIds ?? []).some(
              (cid) => cid.toString() === id.toString(),
            ),
          );

    if (customCollectionIdsToProcess.length > 0 && remainingBatch > 0) {
      const collectionsWithPending: {
        id: Id<'collections'>;
        collection: Doc<'collections'>;
        lastRank: number;
        pendingCount: number;
      }[] = [];

      for (const collId of customCollectionIdsToProcess) {
        const coll = await ctx.db.get(collId);
        if (!coll) continue;
        const prog = await getCollectionProgressHelper(ctx, userId, courseId, collId);
        const lastRank = prog?.lastRankProcessed ?? 0;
        const cardsAdded = prog?.cardsAdded ?? 0;
        const pending = coll.textCount - cardsAdded;
        if (pending > 0) {
          collectionsWithPending.push({
            id: collId,
            collection: coll,
            lastRank,
            pendingCount: pending,
          });
        }
      }

      if (collectionsWithPending.length > 0) {
        const allocations = new Map<string, number>();
        const pool = [...collectionsWithPending];
        let remaining = remainingBatch;

        while (remaining > 0 && pool.length > 0) {
          const idx = Math.floor(Math.random() * pool.length);
          const entry = pool[idx];
          const key = entry.id.toString();
          allocations.set(key, (allocations.get(key) ?? 0) + 1);
          entry.pendingCount--;
          if (entry.pendingCount <= 0) pool.splice(idx, 1);
          remaining--;
        }

        for (const entry of collectionsWithPending) {
          const count = allocations.get(entry.id.toString()) ?? 0;
          if (count === 0) continue;

          const texts = await getNextTextsFromRank(ctx, entry.id, entry.lastRank, count, { forUserId: userId });
          if (texts.length === 0) continue;

          const { cardsInserted, newLastRank } = await createCardsFromTexts(
            ctx, texts, deck, entry.id, course,
          );

          totalCardsInserted += cardsInserted;
          totalTextsProcessed += texts.length;
          remainingBatch -= texts.length;

          await updateCollectionProgress(
            ctx, userId, courseId, entry.id, texts.length, newLastRank,
          );

          const phase1Priority = priorityForCollection(entry.id);
          for (const text of texts) {
            await ctx.scheduler.runAfter(
              0, internal.features.decks.prepareCardContent,
              {
                textId: text._id,
                baseLanguages: course.baseLanguages,
                targetLanguages: course.targetLanguages,
                priority: phase1Priority,
              },
            );
          }

          const customFinalRank = Math.max(entry.lastRank, newLastRank);
          const upcomingCustomTexts = await getNextTextsFromRank(
            ctx, entry.id, customFinalRank, CONTENT_LOOKAHEAD_SIZE, { forUserId: userId },
          );
          for (const text of upcomingCustomTexts) {
            await ctx.scheduler.runAfter(
              0, internal.features.decks.prepareCardContent,
              {
                textId: text._id,
                baseLanguages: course.baseLanguages,
                targetLanguages: course.targetLanguages,
                priority: phase1Priority,
              },
            );
          }
        }
      }
    }

    // --- Phase 2: Fill remaining batch from the difficulty collection (only for level collections) ---
    if (isLevelCollection && remainingBatch > 0 && !skipPremadeSource) {
      // Deduct sentences quota for difficulty-collection cards
      const quota = await checkQuota(ctx, userId, FEATURE_IDS.SENTENCES, remainingBatch);
      if (quota.synced && !quota.allowed) {
        // Clamp to whatever balance is left
        if (quota.balance > 0) {
          remainingBatch = quota.balance;
        } else {
          // No sentences left — skip Phase 2 entirely, return Phase 1 results
          if (totalCardsInserted > 0) {
            await ctx.db.patch(deck._id, { cardCount: deck.cardCount + totalCardsInserted });
          }
          return {
            cardsAdded: totalTextsProcessed,
            totalCardsInDeck: deck.cardCount + totalCardsInserted,
          };
        }
      }

      const progress = await getCollectionProgressHelper(
        ctx,
        userId,
        courseId,
        args.collectionId,
      );

      const cardsAlreadyAdded = progress?.cardsAdded ?? 0;
      const lastRankProcessed = progress?.lastRankProcessed ?? 0;

      const textsToAdd = await getNextTextsFromRank(
        ctx,
        args.collectionId,
        lastRankProcessed,
        remainingBatch,
        { onlyCurriculum: true },
      );

      if (textsToAdd.length > 0) {
        await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, textsToAdd.length);

        const { cardsInserted, newLastRank } = await createCardsFromTexts(
          ctx,
          textsToAdd,
          deck,
          args.collectionId,
          course,
        );

        totalCardsInserted += cardsInserted;
        totalTextsProcessed += textsToAdd.length;

        await updateCollectionProgress(
          ctx,
          userId,
          courseId,
          args.collectionId,
          textsToAdd.length,
          newLastRank,
        );

        const phase2Priority = priorityForCollection(args.collectionId);
        for (const text of textsToAdd) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.prepareCardContent,
            {
              textId: text._id,
              baseLanguages: course.baseLanguages,
              targetLanguages: course.targetLanguages,
              priority: phase2Priority,
            },
          );
        }

        const finalLastRank = Math.max(lastRankProcessed, newLastRank);
        const upcomingTexts = await getNextTextsFromRank(
          ctx,
          args.collectionId,
          finalLastRank,
          CONTENT_LOOKAHEAD_SIZE,
          { onlyCurriculum: true },
        );

        for (const text of upcomingTexts) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.prepareCardContent,
            {
              textId: text._id,
              baseLanguages: course.baseLanguages,
              targetLanguages: course.targetLanguages,
              priority: phase2Priority,
            },
          );
        }

        // Auto-advance: if the collection is now complete and is the active one,
        // move to the next incomplete collection (or clear if last).
        // Walks forward within the same collection generation — new-dataset
        // collections advance by `order + 1`, legacy collections walk
        // LEGACY_LEVEL_ORDER. See findNextIncompleteCollection / getNextCollection.
        const newCardsAdded = cardsAlreadyAdded + textsToAdd.length;
        const collection = await ctx.db.get(args.collectionId);
        if (collection && newCardsAdded >= collection.textCount) {
          const latestSettings = await getCourseSettings(ctx, courseId);
          if (
            latestSettings?.activeCollectionId?.toString() ===
            args.collectionId.toString()
          ) {
            // Start the search at the collection AFTER the one we just
            // completed, so a partially-filled current row can't be picked.
            const startCollection = await getNextCollection(ctx, collection);
            const next = startCollection
              ? await findNextIncompleteCollection(
                ctx,
                startCollection,
                userId,
                courseId,
              )
              : null;
            await setActiveCollectionOnSettings(ctx, courseId, next?._id);
          }
        }
      }
    }

    // Update deck card count
    if (totalCardsInserted > 0) {
      await ctx.db.patch(deck._id, { cardCount: deck.cardCount + totalCardsInserted });
    }

    return {
      cardsAdded: totalTextsProcessed,
      totalCardsInDeck: deck.cardCount + totalCardsInserted,
    };
  },
});

/**
 * Ensure content (translations + audio) exists for a specific card.
 * Called automatically when a card is displayed and has missing content.
 */
export const ensureCardContent = mutation({
  args: {
    textId: v.id('texts'),
  },
  returns: v.object({
    translationsScheduled: v.number(),
    audioScheduled: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { translationsScheduled: 0, audioScheduled: 0 };

    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return { translationsScheduled: 0, audioScheduled: 0 };

    // Verify the user actually has a card for this text in their deck
    const card = await getCardByDeckAndText(ctx, deck._id, args.textId);
    if (!card) return { translationsScheduled: 0, audioScheduled: 0 };

    const text = await ctx.db.get(args.textId);
    if (!text) return { translationsScheduled: 0, audioScheduled: 0 };

    // Prioritize when this card is from the user's currently-active
    // collection. priority: 2 because `ensureCardContent` fires during
    // review/study — the user is staring at the card right now and is
    // blocked on its content. Same tier as placement test / onboarding
    // seed. Comparing IDs by string keeps the check resilient if either
    // field is undefined.
    const settings = await getCourseSettings(ctx, active.course._id);
    const priority =
      settings?.activeCollectionId &&
      card.collectionId &&
      settings.activeCollectionId === card.collectionId
        ? 2
        : 0;

    return scheduleMissingContent(
      ctx,
      args.textId,
      text,
      active.course.baseLanguages,
      active.course.targetLanguages,
      { priority },
    );
  },
});

/**
 * Query the next N upcoming (due) cards for a given scheduling mode. The card
 * set differs by mode: `learn_new` pulls only new (non-graduated) cards via
 * the graduated index, while `learnAndReview` / `radio` pull all due cards.
 */
async function getUpcomingCardsForMode(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
  mode: SchedulingMode,
  now: number,
): Promise<Doc<'cards'>[]> {
  if (mode === 'learn_new') {
    return ctx.db
      .query('cards')
      .withIndex('by_deck_hidden_mastered_graduated_due', (q) =>
        q
          .eq('deckId', deckId)
          .eq('isHidden', false)
          .eq('isMastered', false)
          .eq('isGraduated', false)
          .lte('dueDate', now),
      )
      .order('asc')
      .take(ENSURE_CONTENT_LOOKAHEAD);
  }
  return ctx.db
    .query('cards')
    .withIndex('by_deckId_and_isHidden_and_isMastered_and_dueDate', (q) =>
      q
        .eq('deckId', deckId)
        .eq('isHidden', false)
        .eq('isMastered', false)
        .lte('dueDate', now),
    )
    .order('asc')
    .take(ENSURE_CONTENT_LOOKAHEAD);
}

/**
 * Schedule missing content (translations + TTS) for the supplied due cards,
 * then pre-prep the active premade collection's upcoming texts. Shared by the
 * per-mode (`ensureUpcomingCardsContent`) and all-modes
 * (`ensureUpcomingCardsContentAllModes`) ensure mutations. Returns the number
 * of due cards processed.
 */
async function scheduleContentForUpcomingCards(
  ctx: MutationCtx,
  userId: string,
  active: { settings: Doc<'userSettings'>; course: Doc<'courses'> },
  cards: Doc<'cards'>[],
  activeCollectionId: Id<'collections'> | undefined,
): Promise<number> {
  let processed = 0;
  // Batch-load the texts for all due cards up front (one concurrent read
  // instead of one sequential `ctx.db.get` per card) before the sequential
  // scheduleMissingContent loop.
  const texts = await Promise.all(cards.map((card) => ctx.db.get(card.textId)));
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const text = texts[i];
    if (!text) continue;
    // Bump priority for cards in the user's currently-active collection
    // so their content jumps to the front of the TTS / LLM queues.
    // priority: 2 because these are the lookahead cards the user will reach
    // within the current (or an imminent) session, so they're effectively
    // blocking.
    const priority =
      activeCollectionId &&
      card.collectionId &&
      activeCollectionId === card.collectionId
        ? 2
        : 0;
    await scheduleMissingContent(
      ctx,
      card.textId,
      text,
      active.course.baseLanguages,
      active.course.targetLanguages,
      { priority },
    );
    processed++;
  }

  // Pre-prep the next batch of upcoming texts in the active premade
  // collection — the ones a future addCardsFromCollection call would pull
  // in. Without this, a user who exhausts due cards and clicks "Add" has
  // to wait on TTS + translation for the freshly added cards.
  if (activeCollectionId) {
    const collection = await ctx.db.get(activeCollectionId);
    if (collection && isPremadeLevelCollection(collection)) {
      const progress = await getCollectionProgressHelper(
        ctx,
        userId,
        active.course._id,
        activeCollectionId,
      );
      const lastRank = progress?.lastRankProcessed ?? 0;
      const upcomingTexts = await getNextTextsFromRank(
        ctx,
        activeCollectionId,
        lastRank,
        CONTENT_LOOKAHEAD_SIZE,
        { onlyCurriculum: true },
      );
      for (const text of upcomingTexts) {
        await scheduleMissingContent(
          ctx,
          text._id,
          text,
          active.course.baseLanguages,
          active.course.targetLanguages,
        );
      }
    }
  }

  return processed;
}

/**
 * Ensure content for the next N due cards in the user's active deck.
 * Called from the learning mode to pre-generate translations and audio
 * for upcoming cards so they're ready before the user reaches them.
 */
export const ensureUpcomingCardsContent = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return 0;
    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return 0;

    const settings = await getCourseSettings(ctx, active.course._id);
    const schedulingMode = settings?.schedulingMode ?? 'learnAndReview';
    const activeCollectionId = settings?.activeCollectionId;

    const cards = await getUpcomingCardsForMode(
      ctx,
      deck._id,
      schedulingMode,
      Date.now(),
    );

    return scheduleContentForUpcomingCards(
      ctx,
      userId,
      active,
      cards,
      activeCollectionId,
    );
  },
});

// Scheduling modes whose upcoming card sets differ for content purposes.
// `radio` shares `learnAndReview`'s due-card selection, so warming these two
// covers all three modes.
const WARMABLE_SCHEDULING_MODES: SchedulingMode[] = ['learn_new', 'learnAndReview'];

/**
 * Ensure content for the upcoming cards across *all* scheduling modes, so any
 * mode the user picks starts instantly. Called from the home screen (with no
 * args) to pre-warm content before the user enters a learning session.
 *
 * Unlike `ensureUpcomingCardsContent`, which only warms the user's currently
 * saved mode, this merges the upcoming cards from each mode's selection branch
 * (deduped by card id) so neither mode is left with missing content.
 */
export const ensureUpcomingCardsContentAllModes = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return 0;
    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return 0;

    const settings = await getCourseSettings(ctx, active.course._id);
    const activeCollectionId = settings?.activeCollectionId;

    const now = Date.now();
    const cardLists = await Promise.all(
      WARMABLE_SCHEDULING_MODES.map((mode) =>
        getUpcomingCardsForMode(ctx, deck._id, mode, now),
      ),
    );

    // Merge + dedup by card id so overlapping cards are scheduled once.
    const byId = new Map<Id<'cards'>, Doc<'cards'>>();
    for (const list of cardLists) {
      for (const card of list) {
        if (!byId.has(card._id)) byId.set(card._id, card);
      }
    }

    return scheduleContentForUpcomingCards(
      ctx,
      userId,
      active,
      Array.from(byId.values()),
      activeCollectionId,
    );
  },
});

// ============================================================================
// INTERNAL FUNCTIONS
// ============================================================================

/**
 * Internal mutation to prepare card content (translations + TTS).
 */
export const prepareCardContent = internalMutation({
  args: {
    textId: v.id('texts'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
    // Priority is set by the caller at enqueue time — typically by
    // `addCardsFromCollection` which compares the target collection against
    // the user's `activeCollectionId`. We snapshot intent here instead of
    // re-reading the active collection at run time so a user switching
    // collections mid-batch doesn't reshuffle work that's already queued.
    priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    if (!text) return null;

    await scheduleMissingContent(
      ctx,
      args.textId,
      text,
      args.baseLanguages,
      args.targetLanguages,
      { priority: args.priority },
    );
    return null;
  },
});

/**
 * Internal query: translation row for idempotency before calling Google Translate.
 */
export const getTranslationForTextLanguage = internalQuery({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      translatedText: v.string(),
      romanizedText: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();
    if (!row) return null;
    return {
      translatedText: row.translatedText,
      romanizedText: row.romanizedText,
    };
  },
});

/**
 * Internal action to process translation for a card.
 */
export const processTranslationForCard = internalAction({
  args: {
    textId: v.id('texts'),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    text: v.string(),
    audioSpeakerGender: v.optional(v.string()),
    priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
    /**
     * Retranslation flag. Set when this action is dispatched as the
     * Google fallback for a deliberate LLM retranslation (flagTranslation
     * or the model-swap migration). When true, the action skips the
     * "reuse existing translatedText" shortcut and Google-translates fresh,
     * then forwards the flag to `storeTranslationAndScheduleTTS` so the
     * existing row is actually overwritten. False/absent → historical
     * behavior (reuse existing translation if present).
     */
    replaceExisting: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const existingRow = await ctx.runQuery(
        internal.features.decks.getTranslationForTextLanguage,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
        },
      );

      // Mixed-dialect targets (today: es_mixed) pick a deterministic
      // sub-variant per text. The Google translate target is the sub-code so
      // we get regional spelling/vocab; the persisted row keeps the mixed
      // code as `targetLanguage` and records the chosen variant.
      const mixed = resolveMixedVariant(args.targetLanguage, args.textId as string);
      const translateTarget = mixed ? mixed.subCode : args.targetLanguage;
      const regionVariant = mixed?.regionVariant;

      let translation: string;
      let romanizedText: string | undefined;

      // Honor `replaceExisting`: a retranslation that fell back to Google
      // must Google-translate fresh rather than reuse the stale existing
      // translatedText — otherwise the audio would be regenerated against
      // an unchanged translation and we'd write the same row back.
      const reuseExisting = !args.replaceExisting && existingRow !== null;
      if (reuseExisting) {
        translation = existingRow!.translatedText;
        // `=== undefined`: respect the empty-string sentinel from a prior
        // failed attempt so we don't keep re-running the 3-retry burst.
        if (
          ROMANIZATION_LANGUAGES.has(translateTarget) &&
          existingRow!.romanizedText === undefined
        ) {
          try {
            romanizedText = await romanizeText(translation, translateTarget);
          } catch {
            // 3 retries already exhausted — persist sentinel so subsequent
            // ensureContent runs see "tried" and skip rescheduling.
            romanizedText = '';
          }
        } else {
          romanizedText = existingRow!.romanizedText;
        }
      } else {
        translation = await translateText(
          args.text,
          args.sourceLanguage,
          translateTarget,
        );
        if (ROMANIZATION_LANGUAGES.has(translateTarget)) {
          try {
            romanizedText = await romanizeText(translation, translateTarget);
          } catch (err) {
            // 3 retries already exhausted — persist the empty-string
            // sentinel so ensureContent doesn't reschedule another burst.
            console.error(
              `Romanization failed for ${args.targetLanguage} (persisting sentinel):`,
              err instanceof Error ? err.message : err,
            );
            romanizedText = '';
          }
        }
      }

      const voiceName = regionVariant
        ? getVoiceForLanguageVariant(
          args.targetLanguage,
          regionVariant,
          args.audioSpeakerGender,
        )
        : getVoiceForLanguage(args.targetLanguage, args.audioSpeakerGender);

      // Source travels with the romanization value (real or sentinel) so a
      // future strategy swap can target rows produced by the old method.
      // Resolved from `translateTarget` (the actual code romanizeText was
      // given) so mixed dialects record the sub-code's source.
      const romanizationSource =
        romanizedText !== undefined
          ? getRomanizationSource(translateTarget)
          : undefined;

      await ctx.runMutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          translatedText: translation,
          voiceName,
          romanizedText,
          romanizationSource,
          // Legacy Google Translate path (used as the fallback when the LLM
          // queue's stage chain exhausts, or for languages explicitly pinned
          // to `translationProvider: 'google'`).
          translationSource: GOOGLE_TRANSLATE_SOURCE,
          regionVariant,
          priority: args.priority,
          replaceExisting: args.replaceExisting,
          speakerGender: asVoiceGender(args.audioSpeakerGender),
        },
      );
    } catch (err) {
      console.error('[translateCard] Translation error:', {
        textId: args.textId,
        sourceLanguage: args.sourceLanguage,
        targetLanguage: args.targetLanguage,
        error: err,
      });
    }

    return null;
  },
});

/**
 * Internal mutation to store a translation and schedule TTS generation.
 */
export const storeTranslationAndScheduleTTS = internalMutation({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
    translatedText: v.string(),
    voiceName: v.string(),
    romanizedText: v.optional(v.string()),
    /**
     * Identifier of the romanizer that produced `romanizedText` (or
     * attempted to and emitted the empty-string sentinel). Required when
     * `romanizedText` is supplied, omitted otherwise. Persisted alongside
     * the text so a future strategy swap can target rows by source.
     */
    romanizationSource: v.optional(v.string()),
    /**
     * Identifier of the translation method (model + reasoning, or
     * `google-translate-v2` for the legacy path). Persisted on the
     * translation row so a future strategy swap can target rows produced
     * by the old method. Optional during rollout so old call sites that
     * haven't been threaded yet still compile.
     */
    translationSource: v.optional(v.string()),
    /**
     * Concrete regional variant chosen when `targetLanguage` is a mixed code
     * (today: `es_mixed`). Stored on the translation row so the audio player
     * can pick a voice in the matching locale.
     */
    regionVariant: v.optional(v.string()),
    priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
    /**
     * Retranslation flag. Set by callers that deliberately want to overwrite
     * an existing translation — today only `flagTranslation` (the user
     * reported a bad translation and we want the new LLM output to replace
     * the displayed text).
     *
     * When `true` AND a translation row already exists, the mutation
     * replaces `translatedText`, `romanizedText` (matched with its source),
     * `translationSource`, and `regionVariant`. `flagCount` is preserved —
     * it tracks user dissatisfaction history. Audio rows for the language
     * are not touched here; retranslation callers delete them before
     * enqueueing so the no-audio guard below schedules a fresh TTS.
     *
     * When `false`/absent, the historical concurrent-write protection
     * stays in place: existing `translatedText` is never overwritten and
     * metadata is patched only when missing. This is the safe default for
     * the normal new-card insertion path and for any Google-fallback that
     * fires after another write already landed.
     */
    replaceExisting: v.optional(v.boolean()),
    /**
     * Speaker gender ('male' | 'female') the translation was produced under
     * — the card's resolved `audioSpeakerGender`. Persisted on the translation
     * row so the gender-mismatch sweep in `scheduleMissingContent` can
     * invalidate translations whose grammar no longer agrees with the card's
     * current voice gender. Optional during rollout so old call sites that
     * haven't been threaded yet still compile.
     */
    speakerGender: v.optional(voiceGenderValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();

    if (!existing) {
      await ctx.db.insert('translations', {
        textId: args.textId,
        targetLanguage: args.targetLanguage,
        translatedText: args.translatedText,
        // `!== undefined` so the empty-string sentinel ("tried, failed,
        // leave empty") persists on the new row and ensureContent stops
        // rescheduling — otherwise `args.romanizedText === ''` would be
        // dropped by the truthy spread and look like "never attempted".
        ...(args.romanizedText !== undefined
          ? {
            romanizedText: args.romanizedText,
            ...(args.romanizationSource
              ? { romanizationSource: args.romanizationSource }
              : {}),
          }
          : {}),
        ...(args.translationSource
          ? { translationSource: args.translationSource }
          : {}),
        ...(args.regionVariant ? { regionVariant: args.regionVariant } : {}),
        ...(args.speakerGender ? { speakerGender: args.speakerGender } : {}),
      });
    } else if (args.replaceExisting) {
      // Deliberate retranslation: overwrite the translation and its matched
      // metadata. romanizedText and romanizationSource travel as a unit —
      // both replaced together, including the empty-string sentinel. If the
      // caller didn't compute a new romanization (`romanizedText` undefined),
      // clear both fields so the next ensureContent pass regenerates them
      // against the new translatedText.
      const patch: Partial<{
        translatedText: string;
        romanizedText: string | undefined;
        romanizationSource: string | undefined;
        translationSource: string | undefined;
        regionVariant: string | undefined;
        speakerGender: 'male' | 'female';
      }> = {
        translatedText: args.translatedText,
      };
      if (args.romanizedText !== undefined) {
        patch.romanizedText = args.romanizedText;
        patch.romanizationSource = args.romanizationSource;
      } else {
        // Convex `patch` semantics: `undefined` clears the field.
        patch.romanizedText = undefined;
        patch.romanizationSource = undefined;
      }
      if (args.translationSource) {
        patch.translationSource = args.translationSource;
      }
      if (args.regionVariant) {
        patch.regionVariant = args.regionVariant;
      }
      // Update the recorded speakerGender — a retranslation is what fixes a
      // stale gender, so the new row's gender should reflect the current card.
      if (args.speakerGender) {
        patch.speakerGender = args.speakerGender;
      }
      await ctx.db.patch(existing._id, patch);
    } else {
      const patch: Partial<{
        romanizedText: string;
        romanizationSource: string;
        translationSource: string;
        regionVariant: string;
        speakerGender: 'male' | 'female';
      }> = {};
      // Same `!== undefined` reasoning: persist the sentinel on first write
      // but never overwrite a previously-stored real value. Source travels
      // with the value — they're written/cleared as a unit.
      if (
        args.romanizedText !== undefined &&
        existing.romanizedText === undefined
      ) {
        patch.romanizedText = args.romanizedText;
        if (args.romanizationSource) {
          patch.romanizationSource = args.romanizationSource;
        }
      }
      // Translation source is set on first-write of `translatedText` (which
      // happened upstream when the row was inserted). For existing rows we
      // only fill it in if it's missing — the legacy-backfill migration
      // handles older rows, but a concurrent regenerate against an existing
      // row should keep the original source as the canonical record.
      if (args.translationSource && existing.translationSource === undefined) {
        patch.translationSource = args.translationSource;
      }
      if (args.regionVariant && !existing.regionVariant) {
        patch.regionVariant = args.regionVariant;
      }
      // Same "fill if missing" pattern as the other metadata fields. Legacy
      // translation rows written before `speakerGender` existed get stamped
      // here on the first ensureContent pass that reaches them, so the
      // gender-mismatch sweep doesn't loop on them forever.
      if (args.speakerGender && existing.speakerGender === undefined) {
        patch.speakerGender = args.speakerGender;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
    }

    // Release any LLM translation claim now that the translation row exists.
    // The LLM worker keeps the claim alive across a Google fallback so a
    // concurrent scheduleMissingContent can't re-route the same (textId, lang)
    // through the LLM mid-fallback. Calls from the pure-Google path (which
    // never held a claim) see no row and no-op.
    const llmClaim = await ctx.db
      .query('llmTranslationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();
    if (llmClaim) {
      await ctx.db.delete(llmClaim._id);
    }

    const existingAudioForVoice = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language_and_voiceName', (q) =>
        q
          .eq('textId', args.textId)
          .eq('language', args.targetLanguage)
          .eq('voiceName', args.voiceName),
      )
      .first();

    if (!existingAudioForVoice) {
      const claimed = await claimTtsIfAvailable(ctx, args.textId, args.targetLanguage);
      if (claimed) {
        const voiceGender = getVoiceGenderByApiCode(args.voiceName);
        if (voiceGender === undefined) {
          throw new Error(
            `Cannot enqueue TTS: voice "${args.voiceName}" for language "${args.targetLanguage}" is not in the curated voice list.`,
          );
        }
        await ctx.runMutation(
          internal.features.ttsProcessing.enqueueTtsJob,
          {
            provider: getTtsProviderForLanguage(args.targetLanguage),
            args: {
              textId: args.textId,
              text: args.translatedText,
              language: args.targetLanguage,
              voiceName: args.voiceName,
              voiceGender,
              speed: 1,
              regionVariant: args.regionVariant,
            },
            priority: args.priority,
          },
        );
      }
    }

    return null;
  },
});

/**
 * Internal action to romanize a source text (in the texts table).
 */
export const processRomanizationForSourceText = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let romanized: string;
    try {
      romanized = await romanizeText(args.text, args.language);
    } catch (err) {
      // `romanizeText` already retried up to 3 times before throwing.
      // Persist an empty-string sentinel so `scheduleMissingContent` doesn't
      // reschedule another 3-retry burst on every ensureContent call.
      console.error('Source romanization error (persisting sentinel):', err);
      romanized = '';
    }
    // Source recorded even on failure: lets a strategy swap target failed
    // rows by the source that produced the sentinel.
    const romanizationSource = getRomanizationSource(args.language);
    await ctx.runMutation(
      internal.features.decks.storeSourceRomanization,
      {
        textId: args.textId,
        romanizedText: romanized,
        romanizationSource,
      },
    );
    return null;
  },
});

/**
 * Internal mutation to store romanized text on a source text document.
 *
 * Idempotent against a real-value race: only patches when the row hasn't
 * been written yet (`romanizedText === undefined`). The empty-string
 * sentinel for "tried and failed" also wins on first write but never
 * overwrites a previously-stored real value. `romanizationSource` is
 * recorded so a future strategy swap can find + invalidate the row.
 */
export const storeSourceRomanization = internalMutation({
  args: {
    textId: v.id('texts'),
    romanizedText: v.string(),
    romanizationSource: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    if (text && text.romanizedText === undefined) {
      await ctx.db.patch(args.textId, {
        romanizedText: args.romanizedText,
        romanizationSource: args.romanizationSource,
      });
    }
    return null;
  },
});

/**
 * Internal action to romanize an existing translation (backfill).
 */
export const processRomanizationForTranslation = internalAction({
  args: {
    textId: v.id('texts'),
    translatedText: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let romanized: string;
    try {
      romanized = await romanizeText(args.translatedText, args.language);
    } catch (err) {
      // `romanizeText` already retried up to 3 times before throwing.
      // Persist an empty-string sentinel so `scheduleMissingContent` doesn't
      // reschedule another 3-retry burst on every ensureContent call.
      console.error(
        'Translation romanization error (persisting sentinel):',
        err,
      );
      romanized = '';
    }
    // Source recorded even on failure: lets a strategy swap target failed
    // rows by the source that produced the sentinel.
    const romanizationSource = getRomanizationSource(args.language);
    await ctx.runMutation(
      internal.features.decks.storeTranslationRomanization,
      {
        textId: args.textId,
        language: args.language,
        romanizedText: romanized,
        romanizationSource,
      },
    );
    return null;
  },
});

/**
 * Internal mutation to store romanized text on a translation document.
 *
 * Idempotent against a real-value race: only patches when the field hasn't
 * been written yet. The empty-string sentinel for "tried and failed" wins
 * on first write but never overwrites a previously-stored real value.
 * `romanizationSource` is recorded so a future strategy swap can find +
 * invalidate the row.
 */
export const storeTranslationRomanization = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    romanizedText: v.string(),
    romanizationSource: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const translation = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.language),
      )
      .first();
    if (translation && translation.romanizedText === undefined) {
      await ctx.db.patch(translation._id, {
        romanizedText: args.romanizedText,
        romanizationSource: args.romanizationSource,
      });
    }
    return null;
  },
});

/**
 * Internal mutation to store an audio recording.
 */
export const storeAudioRecording = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    voiceName: v.string(),
    storageId: v.id('_storage'),
    ttsQuality: v.optional(ttsQualityValidator),
    ttsProvider: v.optional(ttsProviderValidator),
    voiceGender: voiceGenderValidator,
    speed: v.number(),
    // Word-level timestamps from Scribe, captured during validation. Omit to
    // clear any existing timings (e.g. on a voice swap where they'd be stale).
    wordTimings: v.optional(
      v.array(
        v.object({
          word: v.string(),
          start: v.number(),
          end: v.number(),
        }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingForVoice = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language_and_voiceName', (q) =>
        q
          .eq('textId', args.textId)
          .eq('language', args.language)
          .eq('voiceName', args.voiceName),
      )
      .first();
    const existingAnyVoice = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (!existingForVoice && !existingAnyVoice) {
      await ctx.db.insert('audioRecordings', {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId: args.storageId,
        ttsQuality: args.ttsQuality,
        ttsProvider: args.ttsProvider,
        voiceGender: args.voiceGender,
        speed: args.speed,
        wordTimings: args.wordTimings,
      });
      return null;
    }

    const recordToUpdate = existingForVoice ?? existingAnyVoice;
    if (!recordToUpdate) return null;

    const previousStorageId = recordToUpdate.storageId;
    await ctx.db.patch(recordToUpdate._id, {
      voiceName: args.voiceName,
      storageId: args.storageId,
      ttsQuality: args.ttsQuality,
      ttsProvider: args.ttsProvider,
      voiceGender: args.voiceGender,
      speed: args.speed,
      wordTimings: args.wordTimings,
    });
    if (previousStorageId !== args.storageId) {
      await ctx.storage.delete(previousStorageId);
    }
    return null;
  },
});
