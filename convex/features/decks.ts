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
  resolveCardSpeakerGenders,
  getTtsProviderForLanguage,
  getTranslationConfigForLanguage,
  getMixedVariantByRegion,
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
  ogteLevelToCollectionCode,
  collectionCodeToOgteLevel,
} from '../../lib/constants/onboarding';
import {
  findNextIncompleteCollection,
  getActiveDataset,
  getCollectionProgress as getCollectionProgressHelper,
  getNextCollection,
  getNextTextsFromRank,
  getPremadeLevelCollections,
} from '../db/collections';
import { translateText, romanizeText } from './translation';
import { captureGeneration } from '../lib/posthogAi';
import { EVENTS, track } from '../analytics';
import { costForCharacters } from '../config/aiCosts';
import { getRomanizationSource } from '../lib/localRomanization';
import {
  missingAnnotationKinds,
  TEXT_ANNOTATIONS,
  vAnnotationKind,
  type AnnotationField,
} from '../lib/textAnnotations';
import {
  ROMANIZATION_LANGUAGES,
  IPA_LANGUAGES,
  FURIGANA_LANGUAGES,
  DEFAULT_CONTENT_VERSION,
  getCurrentTranslationVersion,
  getCurrentTtsVersion,
  isTtsVersionStale,
  isTranslationVersionStale,
  postProcessTranslation,
} from '../../lib/languages';
import {
  GOOGLE_TRANSLATE_SOURCE,
  isUserCreatedText,
  mayRegenerateTranslation,
} from '../../lib/translationProvenance';
import { soundsSame } from '../lib/textComparison';
import {
  resolveRetranslation,
  resolveRetranslationIfPending,
} from './cardEditAudit';
import {
  deleteAudioRow,
  deleteAudioRowsForTextLanguage,
  deleteStorageBlobIfUnreferenced,
} from '../lib/audio';
import {
  findReusableAudioAsset,
  resolveAudioPayload,
  scheduleBlobSwapDelete,
  upsertAudioAsset,
  upsertAudioPointer,
} from '../lib/audioAssets';
import { shouldOverwriteProvider } from '../../lib/ttsPrecedence';
import {
  translationValidator,
  audioRecordingValidator,
  ttsQualityValidator,
  ttsProviderValidator,
  ttsPriorityValidator,
  llmPriorityValidator,
  type TtsPriority,
  type LlmPriority,
  voiceGenderValidator,
  asVoiceGender,
  schedulingTrackFromSettings,
  type SchedulingMode,
  type SchedulingTrack,
  type StudyContentFilter,
} from '../types';
import {
  claimTtsIfAvailable,
  hasActiveTtsClaim,
  hasBlockingTtsClaim,
} from './ttsProcessing';
import { languageSupportsStt } from '../../lib/languages';
import {
  claimLlmTranslationIfAvailable,
  getLlmClaim,
  hasBlockingLlmClaim,
  isClaimFresh,
} from './llmTranslationQueue';
import { llmPool, llmWarmPool } from '../lib/workpools';
import {
  buildTextContentBatchForLanguages,
  buildCardSearchableText,
  buildSearchableTextPatchForCard,
} from '../lib/cardContent';
import {
  LEGACY_LEVEL_ORDER,
  collectionRemaining,
  effectiveTextCount,
  isCollectionComplete,
  isPremadeLevelCollection,
} from '../lib/collections';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import { consumeQuota, checkQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { MAX_CARDS_PER_BATCH, ENSURE_CONTENT_LOOKAHEAD } from '../../lib/constants/learning';
import { fetchFreePlayRotation, randomOrderKey } from '../lib/freePlay';
import { fetchTrackDueCards } from '../lib/dueQueue';
import { isCollectionAccessible, requireAccessibleText } from './collections';
import {
  applyMarkCounterDelta,
  clearMarkForAddedText,
  counterDeltaForMark,
  listMarksForCollection,
} from '../db/collectionTextMarks';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Thrown by the schedulers below in probe mode (`opts.probe`) at the FIRST
 * point where a real run would write. Probe mode turns the authoritative
 * content sweep into a pure read: `scheduleContentForUpcomingCards` probes
 * each upcoming card and dispatches a per-card `prepareCardContent` mutation
 * ONLY for cards that need work. A probe pass that finds nothing performs
 * zero writes, and a zero-write mutation cannot lose an OCC race, so the
 * steady-state ensure sweep can no longer be killed by concurrently
 * completing TTS jobs (the 2026-08-20 "audioRecordings changed on every
 * retry" failure) — while staying a single billed mutation.
 */
export class ProbeNeedsWork extends Error {
  constructor() {
    super('probe: content work needed');
  }
}

/**
 * Claim + enqueue a translation job for (text, targetLanguage), the routing
 * slice shared by `scheduleMissingContent` and the collection-preview
 * generation path (`requestPreviewTranslations`). OpenRouter languages go
 * through the LLM queue under a claim; the rest take the legacy Google path
 * (still pool-bounded, claimless). Returns true iff a job was enqueued.
 */
export async function scheduleTranslationForLanguage(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  targetLanguage: string,
  opts: {
    audioSpeakerGender?: string;
    preferredRegionVariant?: string;
    /** Translation-only mode. The landing translation won't enqueue TTS. */
    skipTts?: boolean;
    /**
     * Priority the downstream TTS enqueue (in
     * `storeTranslationAndScheduleTTS`) runs at once the translation lands.
     * Distinct from `llmPriority` below: this is about the audio, that is
     * about the translation. A collection preview wants an interactive
     * translation whose audio, if any, rides the warm pool.
     */
    priority?: TtsPriority;
    /**
     * Tier the translation itself runs at: 'background' routes it to
     * `llmWarmPool` so a warm sweep can't queue ahead of user-facing work.
     * Absent means interactive.
     */
    llmPriority?: LlmPriority;
    /** Read-only probe: throw ProbeNeedsWork instead of writing. */
    probe?: boolean;
  },
): Promise<boolean> {
  const tCfg = getTranslationConfigForLanguage(targetLanguage);
  if (opts.probe) {
    // A fresh LLM claim means a job already owns this translation: the real
    // call would no-op, so it is not "work needed". Priority-aware on purpose:
    // a fresh 'background' claim probed at interactive priority IS needy,
    // because the real run would take it over (cancel the warm job, re-enqueue
    // on llmPool) — a write. Google-path languages are claimless and always
    // enqueue, hence always needy here.
    if (tCfg.provider === 'openrouter') {
      if (
        await hasBlockingLlmClaim(
          ctx,
          text._id,
          targetLanguage,
          opts.llmPriority,
        )
      ) {
        return false;
      }
    }
    throw new ProbeNeedsWork();
  }
  if (tCfg.provider === 'openrouter') {
    const claimId = await claimLlmTranslationIfAvailable(
      ctx,
      text._id,
      targetLanguage,
      opts.llmPriority,
    );
    if (!claimId) return false;
    await ctx.runMutation(
      internal.features.llmTranslationQueue.enqueueLlmTranslation,
      {
        args: {
          textId: text._id,
          sourceLanguage: text.language,
          targetLanguage,
          text: text.text,
          audioSpeakerGender: opts.audioSpeakerGender,
          preferredRegionVariant: opts.preferredRegionVariant,
          skipTts: opts.skipTts,
          priority: opts.priority,
          llmPriority: opts.llmPriority,
        },
      },
    );
    return true;
  }
  // Legacy Google Translate path. Runs through the LLM pools too (for
  // retries + slot bounding); holds no LLM claim, so its onComplete's
  // claim lookup no-ops.
  const pool = opts.llmPriority === 'background' ? llmWarmPool : llmPool;
  await pool.enqueueAction(
    ctx,
    internal.features.decks.processTranslationForCard,
    {
      textId: text._id,
      sourceLanguage: text.language,
      targetLanguage,
      text: text.text,
      audioSpeakerGender: opts.audioSpeakerGender,
      preferredRegionVariant: opts.preferredRegionVariant,
      skipTts: opts.skipTts,
      priority: opts.priority,
    },
    {
      onComplete:
        internal.features.llmTranslationQueue.onGoogleFallbackComplete,
      context: { textId: text._id, targetLanguage },
    },
  );
  return true;
}

/**
 * Resolve the curated gender for `voiceName` and enqueue the TTS job. The
 * shared tail of `scheduleAudioForLanguage` and
 * `storeTranslationAndScheduleTTS`. Claim acquisition deliberately stays at
 * the call sites so write ordering is unchanged.
 */
async function enqueueTtsForVoice(
  ctx: MutationCtx,
  {
    textId,
    text,
    language,
    voiceName,
    regionVariant,
    forceRegen,
    priority,
  }: {
    textId: Id<'texts'>;
    text: string;
    language: string;
    voiceName: string;
    regionVariant: string | undefined;
    forceRegen?: boolean;
    priority?: TtsPriority;
  },
): Promise<void> {
  const voiceGender = getVoiceGenderByApiCode(voiceName);
  if (voiceGender === undefined) {
    throw new Error(
      `Cannot enqueue TTS: voice "${voiceName}" for language "${language}" is not in the curated voice list.`,
    );
  }
  await ctx.runMutation(internal.features.ttsProcessing.enqueueTtsJob, {
    provider: getTtsProviderForLanguage(language),
    args: {
      textId,
      text,
      language,
      voiceName,
      voiceGender,
      speed: 1,
      regionVariant,
      forceRegen,
      priority,
    },
  });
}

/**
 * Fill audio for (text, language), the slice shared by
 * `scheduleMissingContent`, `storeTranslationAndScheduleTTS`'s siblings,
 * and the preview audio-icon click (`requestPreviewAudio`). For the text's
 * own language the source text is synthesized; for any other language the
 * caller must pass the stored translation row (synthesis text + variant
 * pin).
 *
 * Checks the content-addressed `audioAssets` store first: when a fresh asset
 * already exists for this exact (language, gender, dialect, string), the
 * text's pointer row is attached to it and NO job is enqueued, no claim, no
 * synthesis cost, audio is available immediately. On a miss (or with
 * `opts.forceRegen`, the regenerate-audio path, which must synthesize anew)
 * the claim + enqueue flow runs; the job's completion upserts the asset by
 * the same key.
 *
 * Returns true iff audio was filled or a job was enqueued (false when a
 * fresh TTS claim already owns the slot, or the translation is missing).
 */
export async function scheduleAudioForLanguage(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  language: string,
  audioSpeakerGender: string | undefined,
  translation: Doc<'translations'> | null,
  opts?: {
    forceRegen?: boolean;
    priority?: TtsPriority;
    /** Read-only probe: throw ProbeNeedsWork instead of writing. */
    probe?: boolean;
  },
): Promise<boolean> {
  const isSource = language === text.language;
  if (!isSource && !translation) return false;
  if (opts?.probe) {
    // A fresh TTS claim the real run would respect means a job is already
    // filling this slot — not needy. Priority-aware on purpose: a fresh
    // 'background' claim probed at interactive priority IS needy, because
    // the real run would take it over (cancel the warm job, re-enqueue on
    // the interactive pool) — a write. Anything else (cache attach or
    // claim + enqueue) would write too.
    if (await hasBlockingTtsClaim(ctx, text._id, language, opts?.priority)) {
      return false;
    }
    throw new ProbeNeedsWork();
  }
  // For mixed-dialect rows, prefer a voice in the same locale that was
  // picked at translation time and forward the variant to TTS so the
  // validation roundtrip uses the matching STT locale.
  const regionVariant = isSource ? undefined : translation!.regionVariant;
  const voiceName = regionVariant
    ? getVoiceForLanguageVariant(language, regionVariant, audioSpeakerGender)
    : getVoiceForLanguage(language, audioSpeakerGender);
  const spokenText = isSource ? text.text : translation!.translatedText;

  if (!opts?.forceRegen) {
    const voiceGender = getVoiceGenderByApiCode(voiceName);
    if (voiceGender !== undefined) {
      const asset = await findReusableAudioAsset(ctx, {
        language,
        voiceGender,
        regionVariant,
        spokenText,
      });
      if (asset) {
        await upsertAudioPointer(ctx, text._id, language, asset._id);
        return true;
      }
    }
  }

  const claimed = await claimTtsIfAvailable(ctx, text._id, language, opts?.priority);
  if (!claimed) return false;
  await enqueueTtsForVoice(ctx, {
    textId: text._id,
    text: spokenText,
    language,
    voiceName,
    regionVariant,
    forceRegen: opts?.forceRegen,
    priority: opts?.priority,
  });
  return true;
}

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
  opts?: {
    /**
     * Forced regeneration (regenerateCardAudio): audio enqueues bypass the
     * `audioAssets` cache (a hit would make the regenerate button a no-op)
     * and the synthesis job replaces the shared asset in place on completion.
     */
    forceAudioRegen?: boolean;
    /**
     * TTS priority for every audio enqueue this sweep triggers, directly or
     * via a landing translation. Absent = 'interactive'; warm callers
     * (collection warms, deferred placement batches, admin warmups, bulk
     * custom-card import) pass 'background'. See ttsPriorityValidator.
     */
    priority?: TtsPriority;
    /**
     * LLM priority for every translation enqueue this sweep triggers. Absent =
     * 'interactive'; only the warmups that nobody is waiting on pass
     * 'background'. Separate from `priority` above because most warm callers
     * want background AUDIO for a translation the user may be about to read.
     * See llmPriorityValidator.
     */
    llmPriority?: LlmPriority;
    /**
     * Read-only probe: run the sweep's full decision logic but THROW
     * ProbeNeedsWork at the first point a real run would write, and write
     * nothing. In-flight work (fresh TTS/LLM claims) counts as handled, not
     * needy. Completing without the throw means the text needs nothing.
     */
    probe?: boolean;
  },
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sourceLanguage = text.language;

  // Resolve gender for both the voice (audioSpeakerGender) and the translation
  // prompt's <speaker_gender> tag so they agree (otherwise we hit the
  // user-facing "voice is the opposite gender" bug). The full case logic
  // (definitive vs custom-neutral vs premade-neutral) lives in
  // `resolveCardSpeakerGenders` (lib/voices.ts), seeded by textId for a
  // deterministic, retry-stable coin-flip.
  const { audioSpeakerGender, genderPatch } = resolveCardSpeakerGenders(
    text,
    textId,
  );

  if (Object.keys(genderPatch).length > 0) {
    if (opts?.probe) throw new ProbeNeedsWork();
    await ctx.db.patch(textId, genderPatch);
  }

  // Always include the text's own language (`sourceLanguage`) so the
  // source-language branch below queues audio for it regardless of what
  // the caller passed in `baseLanguages`. Without this, a user whose
  // course uses an English VARIANT (`en_gb` / `en_us` / `en_au`) would
  // never get audio for `en` curriculum + placement-test texts.
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
  // needed languages. All three sets in one Promise.all so the read
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
        langsNeedingTranslation.map((lang) => getLlmClaim(ctx, textId, lang)),
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

  // Validate audio rows. Delete stale ones (missing blob, gender drift,
  // superseded provider, bumped ttsVersion). All checks read the row's
  // RESOLVED payload (the shared `audioAssets` row). Deleting a pointer row
  // leaves a still-shared asset untouched; the re-synthesis a stale asset
  // triggers patches that asset in place, healing every other text sharing
  // the string at once.
  // Do not delete while TTS is in flight: `processTTSForCard` may have
  // attached a row whose URL is not yet resolvable, or concurrent cleanup
  // would remove the row while later validation updates expect it to exist
  // (silent no-op).
  const audioPayloadMap = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof resolveAudioPayload>>>
  >();
  for (const [lang, audio] of audioMap) {
    if (!audio) continue;
    const payload = await resolveAudioPayload(ctx, audio);
    if (!payload) {
      // Dangling pointer (asset gone), no usable audio behind this row.
      // Remove it so the enqueue loop below refills the language.
      if (await hasActiveTtsClaim(ctx, textId, lang)) continue;
      if (opts?.probe) throw new ProbeNeedsWork();
      await deleteAudioRow(ctx, audio, { blobAlreadyGone: true });
      audioMap.set(lang, null);
      continue;
    }
    // `db.system.get` (metadata point-read), not `storage.getUrl`: presence
    // is the signal, and the metadata read is far cheaper than minting a
    // signed URL — this loop runs per (card × language) on the ensure path.
    const blobExists =
      (await ctx.db.system.get(payload.storageId)) !== null;
    if (!blobExists) {
      if (await hasActiveTtsClaim(ctx, textId, lang)) {
        continue;
      }
      if (opts?.probe) throw new ProbeNeedsWork();
      // The blob is gone, nothing left to reference-protect; row (and, for
      // a last-pointer row, its dead asset) bookkeeping still runs.
      await deleteAudioRow(ctx, audio, { blobAlreadyGone: true });
      audioMap.set(lang, null);
    } else {
      const genderMismatch =
        (audioSpeakerGender === 'male' || audioSpeakerGender === 'female') &&
        payload.voiceGender !== audioSpeakerGender;
      // Assets carried over from pre-provider-field audio are legacy Google.
      const existingProvider = payload.ttsProvider ?? 'google';
      const currentProvider = getTtsProviderForLanguage(lang);
      // Provider regen is now gated by lib/ttsPrecedence.ts, only the
      // (current, existing) matchups listed there force a delete + re-synth
      // (e.g. google now overwrites azure, to migrate the Arabic dialects
      // off Azure). Unlisted pairs keep the existing audio.
      const providerMismatch = shouldOverwriteProvider(
        currentProvider,
        existingProvider,
      );
      // Version-stale audio: the language's `ttsVersion` config was bumped
      // above what this audio was stamped with (a new voice pool / Gemini prompt
      // / provider). Regenerate. `isTtsVersionStale` encodes the "undefined ===
      // current" rule so un-backfilled rows never storm.
      const versionMismatch = isTtsVersionStale(lang, payload.ttsVersion);
      if (genderMismatch) {
        langsWithAudioGenderDrift.add(lang);
      }
      if (genderMismatch || providerMismatch || versionMismatch) {
        if (opts?.probe) throw new ProbeNeedsWork();
        // Reference-aware delete: a shared asset (or an `editCard`-copied
        // legacy blob) survives while anything else still points at it.
        // Gender drift additionally keeps the asset+blob even as the last
        // pointer: that audio is still CORRECT for this string+voice. It
        // stays in the content-addressed cache so flipping the gender back
        // (or any other text with the same sentence) reuses it for free.
        // Provider/ttsVersion migrations are true obsolescence (a new TTS
        // system) and keep the full garbage collection.
        await deleteAudioRow(ctx, audio, {
          keepAsset: genderMismatch && !providerMismatch && !versionMismatch,
        });
        audioMap.set(lang, null);
      } else {
        audioPayloadMap.set(lang, payload);
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
  //     the audio loop heals the voice but the translation text: produced
  //     with the wrong grammar: survives and gets stamped as if correct by
  //     the "fill if missing" path, so the user ends up hearing the right
  //     voice reading wrong-grammar text.
  //
  // Legacy rows without an audio drift signal are left alone. We have no
  // evidence they're wrong, and a blanket invalidation would cause a regen
  // storm across the database.
  //
  // Content we may not touch is skipped unconditionally. See
  // `mayRegenerateTranslation` (lib/translationProvenance.ts) for the rule:
  // user-created cards in full, plus human-authored rows on premade texts.
  // Note this gates the TEXT only; the audio validity loop above still runs
  // for those cards, so a user-created card whose speaker gender changed gets
  // a matching voice while keeping the wording the user chose.
  //
  // Skip when TTS is in flight: deleting now would race the pending write
  // and leave an audio row pointing at no translation. Defer to the next
  // `scheduleMissingContent` pass.
  //
  // regionVariant of each swept row, captured BEFORE the delete (the row is
  // gone by the time the regen enqueue below runs) so mixed-dialect cards
  // keep their dialect across regeneration instead of re-rolling it.
  const sweptRegionVariants = new Map<string, string>();
  for (const [lang, translation] of translationMap) {
    if (!translation) continue;
    // The one provenance gate for all three triggers below. Covers
    // user-created (custom/chat) cards and human-authored rows alike. Every
    // regeneration site shares this predicate so none of them can drift out of
    // agreement with the others.
    if (!mayRegenerateTranslation(text, translation)) continue;

    const isLegacy = translation.speakerGender === undefined;
    const isDrifted = !isLegacy && translation.speakerGender !== audioSpeakerGender;
    const isLegacyAlongsideDriftedAudio = isLegacy && langsWithAudioGenderDrift.has(lang);
    // Version-stale translation: the language's `translationVersion` config was
    // bumped above this row's stamp (a new model/prompt). Regenerate.
    // `isTranslationVersionStale` encodes the "undefined === current" rule.
    const isVersionStale = isTranslationVersionStale(
      lang,
      translation.translationVersion,
    );

    if (!isDrifted && !isLegacyAlongsideDriftedAudio && !isVersionStale) continue;
    if (await hasActiveTtsClaim(ctx, textId, lang)) continue;
    // Defer while an LLM retranslation is in flight. It will overwrite the row
    // anyway, so deleting now just races the pending write.
    const llmClaim = llmClaimMap.get(lang) ?? null;
    if (llmClaim && isClaimFresh(llmClaim)) continue;

    if (opts?.probe) throw new ProbeNeedsWork();
    if (translation.regionVariant) {
      sweptRegionVariants.set(lang, translation.regionVariant);
    }
    await ctx.db.delete(translation._id);
    translationMap.set(lang, null);
    // Audio for the legacy-alongside-drifted case was already deleted by the
    // validity loop. The block below only fires when the sweep itself owns
    // the delete, i.e. post-PR drift / version bump where the audio looked fine
    // to the validity loop but the translation row is now stale. Reference-aware
    // delete so a blob shared via an `editCard` copy isn't dropped.
    const staleAudio = audioMap.get(lang);
    if (staleAudio) {
      // keepAsset: every trigger here is a CONTENT change (gender drift /
      // translation-version bump regenerating the text), the recording
      // itself is still valid audio of the old string, so it stays in the
      // audioAssets cache instead of being garbage-collected.
      await deleteAudioRow(ctx, staleAudio, { keepAsset: true });
      audioMap.set(lang, null);
    }
  }

  let translationsScheduled = 0;
  let audioScheduled = 0;

  /** Schedule a Scribe backfill for an existing audio row that lacks timings. */
  const scheduleTimingsBackfillIfNeeded = async (lang: string) => {
    const audio = audioMap.get(lang);
    // Payload was resolved (and the row survived) in the validity loop above;
    // shared-asset timings serve every pointing text, so an asset that already
    // has them needs no backfill.
    const payload = audioPayloadMap.get(lang);
    if (!audio || !payload || payload.wordTimings) return;
    // Languages without STT support (e.g. `el`, Azure Fast Transcription
    // can't transcribe `el-GR`) will never get word timings, so don't waste
    // a claim on a backfill that's guaranteed to no-op.
    if (!languageSupportsStt(lang)) return;
    if (opts?.probe) {
      // Claim-held = a job (synthesis or backfill) already owns the slot —
      // unless it's a background claim the real (priority-less, hence
      // interactive) claim below would take over, which is a write.
      if (await hasBlockingTtsClaim(ctx, textId, lang, undefined)) return;
      throw new ProbeNeedsWork();
    }
    const claimed = await claimTtsIfAvailable(ctx, textId, lang);
    if (!claimed) return;
    // Forward the persisted regionVariant for mixed-dialect rows so STT runs
    // against the same locale the voice was synthesized in. Undefined for
    // non-mixed languages and for the source-language (no translations row).
    const regionVariant = translationMap.get(lang)?.regionVariant;
    await ctx.scheduler.runAfter(
      0,
      internal.features.ttsProcessing.backfillWordTimings,
      { textId, language: lang, storageId: payload.storageId, regionVariant },
    );
  };

  // Schedule missing annotations (romanization, IPA) for the source text.
  // `missingAnnotationKinds` tests `=== undefined` per kind (not `!x`) so the
  // empty-string sentinel the process actions write after a failed attempt is
  // honored; without that distinction every ensureContent call would burn
  // another attempt against the same failing input.
  for (const kind of missingAnnotationKinds(sourceLanguage, text)) {
    if (opts?.probe) throw new ProbeNeedsWork();
    await ctx.scheduler.runAfter(0, TEXT_ANNOTATIONS[kind].sourceTextAction, {
      textId,
      text: text.text,
      language: sourceLanguage,
    });
  }

  // Schedule missing content for each required language
  for (const lang of allRequiredLanguages) {
    const hasAudio = audioMap.get(lang) != null;

    if (lang === sourceLanguage) {
      // Source language, no translation needed, maybe TTS
      if (!hasAudio) {
        if (
          await scheduleAudioForLanguage(
            ctx,
            text,
            lang,
            audioSpeakerGender,
            null,
            {
              forceRegen: opts?.forceAudioRegen,
              priority: opts?.priority,
              probe: opts?.probe,
            },
          )
        ) {
          audioScheduled++;
        }
      } else {
        await scheduleTimingsBackfillIfNeeded(lang);
      }
    } else {
      // Different language. Need translation
      const translation = translationMap.get(lang);
      if (!translation) {
        // Route to either the LLM queue or the legacy Google path based on
        // the per-language config in lib/languages.ts. Both paths terminate
        // by writing the `translations` row via storeTranslationAndScheduleTTS,
        // so downstream (romanization, TTS) doesn't care which provider ran.
        if (
          await scheduleTranslationForLanguage(ctx, text, lang, {
            audioSpeakerGender,
            preferredRegionVariant: sweptRegionVariants.get(lang),
            priority: opts?.priority,
            llmPriority: opts?.llmPriority,
            probe: opts?.probe,
          })
        ) {
          translationsScheduled++;
        }
      } else {
        // Translation exists. Backfill missing annotations (romanization,
        // IPA). Same `=== undefined` sentinel semantics as the source-text
        // loop above.
        for (const kind of missingAnnotationKinds(lang, translation)) {
          if (opts?.probe) throw new ProbeNeedsWork();
          await ctx.scheduler.runAfter(
            0,
            TEXT_ANNOTATIONS[kind].translationAction,
            { textId, text: translation.translatedText, language: lang },
          );
        }
        if (!hasAudio) {
          // Defer TTS while an LLM retranslation is in flight for this
          // (textId, lang). Without this guard, `flagTranslation` (which
          // deletes audio + enqueues an LLM retranslation) races with a
          // concurrent `scheduleMissingContent` that would otherwise see
          // "translation exists, audio missing" and enqueue TTS against
          // the OLD `translation.translatedText`, producing stale audio
          // just before the new translation lands. The LLM worker's
          // `storeTranslationAndScheduleTTS` will enqueue TTS for the new
          // text once the LLM completes. The claim was pre-fetched in
          // the batched Promise.all above; no per-iteration DB read here.
          const existingLlmClaim = llmClaimMap.get(lang) ?? null;
          const llmRetranslationInFlight =
            existingLlmClaim !== null && isClaimFresh(existingLlmClaim);
          if (llmRetranslationInFlight) {
            // Skip. The LLM worker owns the next TTS enqueue for this row.
          } else if (
            await scheduleAudioForLanguage(
              ctx,
              text,
              lang,
              audioSpeakerGender,
              translation,
              {
                forceRegen: opts?.forceAudioRegen,
                priority: opts?.priority,
                probe: opts?.probe,
              },
            )
          ) {
            audioScheduled++;
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
          sourceIpa: text.ipaText ?? undefined,
          sourceFurigana: text.furiganaText ?? undefined,
          userCreated: text.userCreated,
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
      ignoredCount: v.number(),
      prioritizedCount: v.number(),
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
    // See getPremadeLevelCollections for the read pattern.
    const { collections } = await getPremadeLevelCollections(ctx);

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
          ignoredCount: progress?.ignoredCount ?? 0,
          prioritizedCount: progress?.prioritizedCount ?? 0,
          // Carry-widened, exactly like getHomeSummary: `cardsAdded` already
          // contains the cutover credit, so the raw textCount would make
          // `collectionRemaining` read 0 on a level that still has texts.
          totalTexts: effectiveTextCount(collection.textCount, progress),
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

    const courseSettings = await getCourseSettings(ctx, courseId);

    const isLevelCollection = isPremadeLevelCollection(collection);
    if (!isLevelCollection) {
      const isChatCollection =
        courseSettings?.chatCollectionId === args.collectionId;
      const isCustomCollection = (
        courseSettings?.activeCustomCollectionIds ?? []
      ).includes(args.collectionId);
      if (!isChatCollection && !isCustomCollection) {
        throw new ConvexError('Collection not accessible');
      }
    }

    // Re-selecting the collection that's already active is a no-op, not an
    // error: `setCollectionTextMark` can complete a collection (via
    // `ignoredCount`) without running auto-advance, leaving it complete AND
    // still active. The guard below would then reject a click that changes
    // nothing.
    if (courseSettings?.activeCollectionId === args.collectionId) return null;

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      args.collectionId,
    );

    // Complete = every text either added or deliberately ignored, counted
    // against the carry-widened total so this matches the predicate the UI
    // uses to decide whether to offer the button at all (empty collections
    // included, there's nothing to finish, so selecting one isn't an error).
    if (
      progress &&
      effectiveTextCount(collection.textCount, progress) > 0 &&
      isCollectionComplete(collection.textCount, progress)
    ) {
      throw new ConvexError('This collection is already complete');
    }

    await setActiveCollectionOnSettings(ctx, courseId, args.collectionId);
    return null;
  },
});

/**
 * OGTE level (1..20) of the course's active collection, or null when the
 * active collection isn't a coded dataset level (custom/chat/legacy CEFR).
 * Read by the one-time difficulty check in the learn view to seed its
 * slider at the level the user is actually on.
 */
export const getActiveDifficultyLevel = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const settings = await getCourseSettings(ctx, active.course._id);
    if (!settings?.activeCollectionId) return null;
    const collection = await ctx.db.get(settings.activeCollectionId);
    return collectionCodeToOgteLevel(collection?.code);
  },
});

/**
 * The next sentences that would actually be added for THIS user from the
 * dataset level `ogteLevel`. The difficulty-check dialog's preview, so the
 * user judges the level on the exact material coming up next, not generic
 * samples. Starts past the user's frontier (`lastRankProcessed`) like the
 * add-cards flow; the source side renders in the base language once its
 * translation exists, the target side is optional (still generating →
 * the row falls back to the source text).
 */
export const getUpcomingSentencesForLevel = query({
  args: {
    ogteLevel: v.number(),
    count: v.optional(v.number()),
  },
  returns: v.object({
    /** The level exists in the active dataset. */
    exists: v.boolean(),
    /**
     * The course can move to this level. It exists and the user hasn't
     * already completed it (`setActiveCollectionByLevel` would throw).
     * Lets the pager disable a step instead of dead-ending on an error
     * toast. Always true for the level that is already active.
     */
    switchable: v.boolean(),
    sentences: v.array(
      v.object({
        position: v.number(),
        sourceText: v.string(),
        targetText: v.optional(v.string()),
        targetRomanization: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const MISSING = { exists: false, switchable: false, sentences: [] };

    const userId = await getAuthUserId(ctx);
    if (!userId) return MISSING;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return MISSING;
    const course = active.course;

    const code = ogteLevelToCollectionCode(args.ogteLevel);
    if (!code) return MISSING;
    const activeDataset = await getActiveDataset(ctx);
    if (!activeDataset) return MISSING;
    const collection = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_code', (q) =>
        q.eq('datasetId', activeDataset._id).eq('code', code),
      )
      .first();
    if (!collection) return MISSING;

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      course._id,
      collection._id,
    );

    // Mirror `setActiveCollectionByLevel`'s guard so the UI can't offer a
    // step the mutation would reject. The already-active level stays
    // switchable, selecting it is a no-op there, not an error.
    const courseSettings = await getCourseSettings(ctx, course._id);
    const isActiveLevel = courseSettings?.activeCollectionId === collection._id;
    const isComplete =
      progress != null &&
      effectiveTextCount(collection.textCount, progress) > 0 &&
      isCollectionComplete(collection.textCount, progress);
    const switchable = isActiveLevel || !isComplete;

    const frontier = progress?.lastRankProcessed ?? 0;
    const count = Math.min(Math.max(args.count ?? 5, 1), 10);
    const texts = await getNextTextsFromRank(ctx, collection._id, frontier, count, {
      onlyCurriculum: true,
    });

    const sourceLanguage = course.baseLanguages[0];
    const targetLanguage = course.targetLanguages[0];
    const sentences = await Promise.all(
      texts.map(async (text, position) => {
        let sourceText = text.text;
        if (sourceLanguage && sourceLanguage !== text.language) {
          const sourceTranslation = await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', text._id).eq('targetLanguage', sourceLanguage),
            )
            .first();
          if (sourceTranslation) sourceText = sourceTranslation.translatedText;
        }

        let targetText: string | undefined;
        let targetRomanization: string | undefined;
        if (targetLanguage && targetLanguage !== text.language) {
          const targetTranslation = await ctx.db
            .query('translations')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', text._id).eq('targetLanguage', targetLanguage),
            )
            .first();
          if (targetTranslation) {
            targetText = targetTranslation.translatedText;
            // Empty string is the "tried and failed" romanization sentinel.
            targetRomanization = targetTranslation.romanizedText || undefined;
          }
        } else if (targetLanguage && targetLanguage === text.language) {
          targetText = text.text;
          targetRomanization = text.romanizedText || undefined;
        }

        return { position, sourceText, targetText, targetRomanization };
      }),
    );

    return { exists: true, switchable, sentences };
  },
});

/**
 * Switch the active collection to the dataset level for `ogteLevel`.
 * The difficulty-check dialog's "switch level" action, which only knows the
 * slider's level, not a collection id. Same safety rails as
 * `setActiveCollection`: no-ops when the level is already active, refuses a
 * collection the user has already completed.
 */
export const setActiveCollectionByLevel = mutation({
  args: {
    ogteLevel: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const code = ogteLevelToCollectionCode(args.ogteLevel);
    if (!code) throw new ConvexError('Invalid level');

    const activeDataset = await getActiveDataset(ctx);
    if (!activeDataset) throw new ConvexError('No active dataset');
    const collection = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_code', (q) =>
        q.eq('datasetId', activeDataset._id).eq('code', code),
      )
      .first();
    if (!collection) throw new ConvexError('Collection not found');

    const courseSettings = await getCourseSettings(ctx, courseId);
    if (courseSettings?.activeCollectionId === collection._id) return null;

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      collection._id,
    );
    if (
      progress &&
      effectiveTextCount(collection.textCount, progress) > 0 &&
      isCollectionComplete(collection.textCount, progress)
    ) {
      throw new ConvexError('This collection is already complete');
    }

    await setActiveCollectionOnSettings(ctx, courseId, collection._id);
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
  // `legacy: true` flag and never got their `origin` backfilled), otherwise
  // cards inserted from them get `collectionOrigin: undefined` and never
  // match the 'course' filter even though the UI treats them as course content.
  const collection = await ctx.db.get(collectionId);
  const collectionOrigin: 'premade' | 'custom' | 'chat' | undefined =
    collection?.origin
    ?? (collection && isPremadeLevelCollection(collection) ? 'premade' : undefined);

  // With separateModeTracking on, seed the writing track at creation (a new
  // card's writing schedule is identical to its shared one) so the card is
  // immediately visible to the writing-due indexes without a backfill. While
  // it's off, cards stay unseeded. The enable-time seedWritingTrack backfill
  // copies the then-current shared state instead.
  const settingsForSeed = await getCourseSettings(ctx, course._id);
  const seedWritingTrack = settingsForSeed?.separateModeTracking === true;

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
        ...(seedWritingTrack
          ? { writingDueDate: now + cardsInserted, writingIsGraduated: false }
          : {}),
        radioRoundCounter: 0,
        radioPlayCount: 0,
        // Random tiebreaks so that even brand-new cards inserted in a single
        // batch (which would otherwise share creation time + counter) end up
        // in a shuffled free-play order rather than insertion order. The two
        // faces roll separately so their rotations never correlate.
        radioOrderKey: randomOrderKey(),
        freeStudyRoundCounter: 0,
        freeStudyPlayCount: 0,
        freeStudyOrderKey: randomOrderKey(),
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
 *
 * `addedDelta` must be the number of cards actually INSERTED (not texts
 * scanned): direct-adds from the collection preview create cards ahead of the
 * sequential frontier, and the later scan passing over them must not count
 * them a second time.
 *
 * `frontierRank` advances `lastRankProcessed` (monotonic via Math.max).
 * Omit it for out-of-order adds (preview direct-add, prioritized drain).
 * Those must NOT move the frontier, or every unscanned text between the old
 * frontier and the added rank would be silently skipped forever.
 */
export async function updateCollectionProgress(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  update: { addedDelta: number; frontierRank?: number },
): Promise<void> {
  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collectionId,
  );

  if (progress) {
    await ctx.db.patch(progress._id, {
      cardsAdded: progress.cardsAdded + update.addedDelta,
      ...(update.frontierRank !== undefined
        ? {
          lastRankProcessed: Math.max(
            progress.lastRankProcessed ?? 0,
            update.frontierRank,
          ),
        }
        : {}),
    });
  } else {
    await ctx.db.insert('collectionProgress', {
      userId,
      courseId,
      collectionId,
      cardsAdded: update.addedDelta,
      ...(update.frontierRank !== undefined
        ? { lastRankProcessed: update.frontierRank }
        : {}),
    });
  }
}

async function getOrCreateDeck(
  ctx: MutationCtx,
  course: Doc<'courses'>,
): Promise<Doc<'decks'>> {
  const existing = await getDeckByCourseId(ctx, course._id);
  if (existing) return existing;
  const deckId = await ctx.db.insert('decks', {
    courseId: course._id,
    name: `Learning ${course.targetLanguages.join(', ')}`,
    cardCount: 0,
  });
  const deck = await ctx.db.get(deckId);
  if (!deck) throw new ConvexError('Failed to create deck');
  return deck;
}

/**
 * Per-call bound on how many texts the sequential add scan may walk over.
 * Keeps one mutation's reads bounded when the frontier sits at the start of a
 * long ignored/direct-added streak: each scanned text costs ~2 reads (text
 * doc + card point-read), so 1500 ≈ 3k document reads. Well inside Convex's
 * per-transaction limits. The frontier advance is persisted even when nothing
 * addable was found, so the caller can signal `scanIncomplete` and the client
 * re-calls. Each retry resumes past the already-scanned stretch (guaranteed
 * progress). Exported for the scan-continuation test.
 */
export const ADD_SCAN_CAP = 1500;

/**
 * The next texts from a collection that can actually become cards: walks the
 * rank index from `afterRank`, passing over ignored-marked texts and texts
 * that already have a card (preview direct-adds ahead of the frontier).
 *
 * Returns the picked texts plus the new frontier (rank of the last text
 * processed, every text at or below it is added-or-ignored). `exhausted`
 * means the index range ran dry; `capped` means the ADD_SCAN_CAP was hit
 * before filling `limit` with more texts possibly remaining.
 */
async function getNextAddableTextsFromRank(
  ctx: MutationCtx,
  params: {
    collectionId: Id<'collections'>;
    afterRank: number;
    limit: number;
    deckId: Id<'decks'>;
    userId: string;
    courseId: Id<'courses'>;
    options?: { onlyCurriculum?: boolean; forUserId?: string };
    /** Texts already selected by the prioritized drain in this call. */
    excludeTextIds?: Set<string>;
  },
): Promise<{
  picked: Doc<'texts'>[];
  newFrontier: number;
  exhausted: boolean;
  capped: boolean;
}> {
  const { collectionId, afterRank, limit, deckId, userId, courseId } = params;
  if (limit <= 0) {
    return { picked: [], newFrontier: afterRank, exhausted: false, capped: false };
  }

  const picked: Doc<'texts'>[] = [];
  let cursor = afterRank;
  let scanned = 0;
  let exhausted = false;

  while (picked.length < limit && scanned < ADD_SCAN_CAP) {
    // Floor of 50 keeps the skip-heavy worst case at ≤ 30 loop rounds while
    // costing at most ~45 extra text reads in the common instant-hit case.
    const batchSize = Math.min(Math.max(limit * 2, 50), ADD_SCAN_CAP - scanned);
    const batch = await getNextTextsFromRank(
      ctx,
      collectionId,
      cursor,
      batchSize,
      params.options,
    );
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    // Ignore set scoped to exactly this batch's rank window. Bounded by the
    // batch size no matter how many marks the user has in total (a global
    // read would need an unbounded collect and silently miss marks past any
    // fixed cap).
    const [cards, ignoredMarks] = await Promise.all([
      Promise.all(batch.map((t) => getCardByDeckAndText(ctx, deckId, t._id))),
      listMarksForCollection(ctx, userId, courseId, collectionId, 'ignored', {
        minRank: batch[0].collectionRank,
        maxRank: batch[batch.length - 1].collectionRank,
        limit: batch.length,
      }),
    ]);
    const ignoredTextIds = new Set(ignoredMarks.map((m) => m.textId.toString()));
    for (let i = 0; i < batch.length; i++) {
      if (picked.length >= limit) break; // don't pass unprocessed texts
      const text = batch[i];
      cursor = text.collectionRank;
      scanned++;
      if (ignoredTextIds.has(text._id.toString())) continue;
      if (params.excludeTextIds?.has(text._id.toString())) continue;
      if (cards[i]) continue; // direct-added earlier: pass, don't re-count
      picked.push(text);
    }
    // Short batch fully consumed → the range is dry.
    if (picked.length < limit && batch.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  return {
    picked,
    newFrontier: cursor,
    exhausted,
    capped: !exhausted && picked.length < limit && scanned >= ADD_SCAN_CAP,
  };
}

/**
 * Load the texts behind one type of the user's marks for a collection, rank
 * order, up to `limit`. Orphan marks (text deleted, or a card already exists)
 * are cleaned up here without counting toward the batch. The kept marks are
 * NOT deleted yet. `addTextsAsCards` clears them in the same transaction
 * that inserts the cards.
 */
async function drainMarkedTexts(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  deckId: Id<'decks'>,
  mark: 'prioritized' | 'readd',
  limit: number,
): Promise<Doc<'texts'>[]> {
  if (limit <= 0) return [];
  const marks = await listMarksForCollection(
    ctx,
    userId,
    courseId,
    collectionId,
    mark,
    { limit },
  );
  const texts: Doc<'texts'>[] = [];
  for (const markDoc of marks) {
    const text = await ctx.db.get(markDoc.textId);
    const existingCard = text
      ? await getCardByDeckAndText(ctx, deckId, text._id)
      : null;
    if (!text || existingCard) {
      await ctx.db.delete(markDoc._id);
      await applyMarkCounterDelta(
        ctx,
        userId,
        courseId,
        markDoc.collectionId,
        counterDeltaForMark(markDoc.mark, -1),
      );
      continue;
    }
    texts.push(text);
  }
  return texts;
}

/**
 * The out-of-band texts an add call must take before its sequential scan:
 * 'prioritized' marks jump the queue by design; 'readd' marks are un-marked
 * texts the frontier already passed (they'd otherwise be unreachable, since
 * the scan never looks backwards). Rank-ordered within each type,
 * prioritized first.
 */
async function drainQueuedMarkTexts(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  deckId: Id<'decks'>,
  limit: number,
): Promise<Doc<'texts'>[]> {
  const prioritized = await drainMarkedTexts(
    ctx, userId, courseId, collectionId, deckId, 'prioritized', limit,
  );
  const readd = await drainMarkedTexts(
    ctx, userId, courseId, collectionId, deckId, 'readd',
    limit - prioritized.length,
  );
  return [...prioritized, ...readd];
}

/**
 * Turn texts into cards: insert (deduped), clear any marks (keeps the
 * "marks exist only for card-less texts" invariant + counters), and schedule
 * full content (translations + audio) per text. Returns cards inserted.
 */
async function addTextsAsCards(
  ctx: MutationCtx,
  texts: Doc<'texts'>[],
  deck: Doc<'decks'>,
  collectionId: Id<'collections'>,
  course: Doc<'courses'>,
  userId: string,
): Promise<number> {
  if (texts.length === 0) return 0;
  const { cardsInserted } = await createCardsFromTexts(
    ctx,
    texts,
    deck,
    collectionId,
    course,
  );
  for (const text of texts) {
    await clearMarkForAddedText(ctx, userId, course._id, text._id);
    await ctx.scheduler.runAfter(
      0,
      internal.features.decks.prepareCardContent,
      {
        textId: text._id,
        baseLanguages: course.baseLanguages,
        targetLanguages: course.targetLanguages,
      },
    );
  }
  return cardsInserted;
}

/**
 * If `collectionId` is the active premade collection and is now complete.
 * Every text either added or deliberately ignored. Advance the active
 * collection to the next incomplete one (or clear it when none remain).
 * Walks forward within the same collection generation. New-dataset
 * collections advance by `order + 1`, legacy collections walk
 * LEGACY_LEVEL_ORDER. See findNextIncompleteCollection / getNextCollection.
 */
async function maybeAutoAdvanceActiveCollection(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
): Promise<void> {
  const collection = await ctx.db.get(collectionId);
  if (!collection || !isPremadeLevelCollection(collection)) return;
  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collectionId,
  );
  if (!isCollectionComplete(collection.textCount, progress)) return;
  const latestSettings = await getCourseSettings(ctx, courseId);
  if (
    latestSettings?.activeCollectionId?.toString() !== collectionId.toString()
  ) {
    return;
  }
  // Start the search at the collection AFTER the one we just completed, so a
  // partially-filled current row can't be picked.
  const startCollection = await getNextCollection(ctx, collection);
  const next = startCollection
    ? await findNextIncompleteCollection(ctx, startCollection, userId, courseId)
    : null;
  await setActiveCollectionOnSettings(ctx, courseId, next?._id);
}

/**
 * Add cards from a collection to the user's deck.
 * Chat-collection texts are prioritized before the difficulty collection.
 */
export const addCardsFromCollection = mutation({
  args: {
    collectionId: v.id('collections'),
    batchSize: v.number(),
    /** When true, only add from this specific collection. Skip custom collection mixing. */
    exclusive: v.optional(v.boolean()),
  },
  returns: v.object({
    cardsAdded: v.number(),
    totalCardsInDeck: v.number(),
    /**
     * True when the sequential scan hit its per-call read cap before filling
     * the batch and the collection wasn't exhausted. Addable texts may exist
     * beyond the scanned window. The frontier advance is already persisted,
     * so the caller re-calls to continue (each retry makes
     * guaranteed progress).
     */
    scanIncomplete: v.boolean(),
    /**
     * True when Phase 2 was skipped because the SENTENCES quota is exhausted.
     * Distinguishes "0 cards because out of quota" from "collection drained"
     * Without it the two are byte-identical and clients would latch a
     * quota-limited collection as permanently exhausted. Optional so replies
     * from a not-yet-redeployed backend still validate.
     */
    quotaLimited: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const clampedBatchSize = Math.max(1, Math.min(MAX_CARDS_PER_BATCH, Math.floor(args.batchSize)));

    const deck = await getOrCreateDeck(ctx, course);

    let totalCardsInserted = 0;
    let remainingBatch = clampedBatchSize;
    let scanIncomplete = false;

    // --- Phase 1: Add from custom collection(s) ---
    // When the requested collection is a level collection (learning mode auto-add),
    // drain pending texts from ALL selected custom collections randomly.
    // When the requested collection is a custom collection (collection detail "add" button),
    // only add from that specific collection.
    const courseSettings = await getCourseSettings(ctx, courseId);
    const requestedCollection = await ctx.db.get(args.collectionId);
    const isLevelCollection = requestedCollection
      ? isPremadeLevelCollection(requestedCollection)
      : false;

    // Content-source filter: scopes the learning-mode auto-add flow only.
    // When `exclusive` is set, the user is explicitly adding from a specific
    // collection via the collection detail dialog. Honor that source directly.
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
        // Ignored texts are deliberately excluded from auto-add, so they
        // don't count as pending. (Custom collections never carry cutover
        // credit, so widening here is a no-op. It just keeps every
        // `collectionRemaining` call on the effective total.)
        const pending = collectionRemaining(
          effectiveTextCount(coll.textCount, prog),
          prog,
        );
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

          // Prioritized/readd marks jump the queue (rank-ordered, frontier
          // untouched); the sequential scan fills the rest, skipping ignored
          // and already-carded texts.
          const queuedTexts = await drainQueuedMarkTexts(
            ctx, userId, courseId, entry.id, deck._id, count,
          );
          const scan = await getNextAddableTextsFromRank(ctx, {
            collectionId: entry.id,
            afterRank: entry.lastRank,
            limit: count - queuedTexts.length,
            deckId: deck._id,
            userId,
            courseId,
            options: { forUserId: userId },
            excludeTextIds: new Set(queuedTexts.map((t) => t._id.toString())),
          });
          if (scan.capped) scanIncomplete = true;

          const texts = [...queuedTexts, ...scan.picked];
          const cardsInserted = await addTextsAsCards(
            ctx, texts, deck, entry.id, course, userId,
          );

          totalCardsInserted += cardsInserted;
          remainingBatch -= texts.length;

          if (cardsInserted > 0 || scan.newFrontier > entry.lastRank) {
            await updateCollectionProgress(ctx, userId, courseId, entry.id, {
              addedDelta: cardsInserted,
              frontierRank: scan.newFrontier,
            });
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
          // No sentences left. Skip Phase 2 entirely, return Phase 1 results
          if (totalCardsInserted > 0) {
            await ctx.db.patch(deck._id, { cardCount: deck.cardCount + totalCardsInserted });
          }
          return {
            cardsAdded: totalCardsInserted,
            totalCardsInDeck: deck.cardCount + totalCardsInserted,
            scanIncomplete,
            quotaLimited: true,
          };
        }
      }

      const progress = await getCollectionProgressHelper(
        ctx,
        userId,
        courseId,
        args.collectionId,
      );
      const lastRankProcessed = progress?.lastRankProcessed ?? 0;

      // Prioritized/readd marks jump the queue (rank-ordered, frontier
      // untouched); the sequential scan fills the rest, skipping ignored
      // texts and cards direct-added ahead of the frontier.
      const queuedTexts = await drainQueuedMarkTexts(
        ctx, userId, courseId, args.collectionId, deck._id, remainingBatch,
      );
      const scan = await getNextAddableTextsFromRank(ctx, {
        collectionId: args.collectionId,
        afterRank: lastRankProcessed,
        limit: remainingBatch - queuedTexts.length,
        deckId: deck._id,
        userId,
        courseId,
        options: { onlyCurriculum: true },
        excludeTextIds: new Set(queuedTexts.map((t) => t._id.toString())),
      });
      if (scan.capped) scanIncomplete = true;

      const textsToAdd = [...queuedTexts, ...scan.picked];

      if (textsToAdd.length > 0) {
        await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, textsToAdd.length);

        const cardsInserted = await addTextsAsCards(
          ctx, textsToAdd, deck, args.collectionId, course, userId,
        );
        totalCardsInserted += cardsInserted;

        await updateCollectionProgress(ctx, userId, courseId, args.collectionId, {
          addedDelta: cardsInserted,
          frontierRank: scan.newFrontier,
        });

        // Warm-ahead: pre-generate content for the NEXT batch beyond the
        // just-advanced frontier, so it is ready by the time a fast reviewer
        // adds it (the full pipeline takes ~15-40s per card, and batches were
        // observed being added ~30s apart). Fire-and-forget in its own
        // transaction so a warm failure can't fail the add.
        await ctx.scheduler.runAfter(
          0,
          internal.features.decks.warmNextCollectionBatch,
          {
            collectionId: args.collectionId,
            courseId,
            deckId: deck._id,
            userId,
            afterRank: scan.newFrontier,
            limit: Math.min(clampedBatchSize, ENSURE_CONTENT_LOOKAHEAD),
          },
        );

        // Auto-advance: if the collection is now complete (every text added
        // or deliberately ignored) and is the active one, move to the next
        // incomplete collection (or clear if last).
        await maybeAutoAdvanceActiveCollection(ctx, userId, courseId, args.collectionId);
      } else if (scan.newFrontier > lastRankProcessed) {
        // Nothing addable in the scanned window (an ignored/direct-added
        // streak), persist the frontier advance so the next call continues
        // past it instead of re-scanning the same stretch.
        await updateCollectionProgress(ctx, userId, courseId, args.collectionId, {
          addedDelta: 0,
          frontierRank: scan.newFrontier,
        });
        await maybeAutoAdvanceActiveCollection(ctx, userId, courseId, args.collectionId);
      }
    }

    // Update deck card count
    if (totalCardsInserted > 0) {
      await ctx.db.patch(deck._id, { cardCount: deck.cardCount + totalCardsInserted });
    }

    // One event per batch with a count, not one per card. Adding 50 cards is
    // a single user decision, and modelling it as 50 events would both distort
    // the behavioural picture and multiply the bill.
    if (totalCardsInserted > 0) {
      await track(ctx, userId, EVENTS.CARDS_ADDED, {
        count: totalCardsInserted,
        source: 'collection',
        collection_id: args.collectionId,
        deck_size_after: deck.cardCount + totalCardsInserted,
      });
    }

    return {
      cardsAdded: totalCardsInserted,
      totalCardsInDeck: deck.cardCount + totalCardsInserted,
      scanIncomplete,
      quotaLimited: false,
    };
  },
});

/**
 * Warm-ahead for the batch add: pre-generate content (translations + audio)
 * for the next addable texts beyond the collection frontier WITHOUT adding
 * cards, so the next "add cards" batch is ready before the user reaches it.
 * Scheduled by `addCardsFromCollection` after each successful premade add.
 *
 * Interactive priority on purpose: these texts are one batch away from the
 * user's screen (observed add cadence ~30s between batches), which is
 * "imminently on screen" under the ttsPriorityValidator classification.
 * Marked (prioritized/readd) texts can occasionally jump the queue ahead of
 * this prediction; the warmed texts stay next-in-line, so the work is spent
 * early rather than wasted. No SENTENCES quota is consumed: nothing is added.
 */
export const warmNextCollectionBatch = internalMutation({
  args: {
    collectionId: v.id('collections'),
    courseId: v.id('courses'),
    deckId: v.id('decks'),
    userId: v.string(),
    afterRank: v.number(),
    limit: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId);
    if (!course) return null;
    const scan = await getNextAddableTextsFromRank(ctx, {
      collectionId: args.collectionId,
      afterRank: args.afterRank,
      limit: args.limit,
      deckId: args.deckId,
      userId: args.userId,
      courseId: args.courseId,
      options: { onlyCurriculum: true },
    });
    for (const text of scan.picked) {
      // Inline (no per-text dispatch): these texts are brand-new to the
      // pipeline, so no jobs are completing against their rows yet and the
      // OCC contention the ensure sweep needed dispatch for doesn't apply.
      // One bad text must still not abort the rest of the warm.
      try {
        await scheduleMissingContent(
          ctx,
          text._id,
          text,
          course.baseLanguages,
          course.targetLanguages,
        );
      } catch (error) {
        console.error('[warmNextCollectionBatch] scheduleMissingContent failed for one text — continuing', {
          textId: text._id,
          error,
        });
      }
    }
    return null;
  },
});

/**
 * Add ONE specific text from a collection to the user's deck. The collection
 * preview's per-card "Add" button. The card is created ahead of the
 * sequential frontier; the frontier is deliberately NOT advanced (the scan
 * later passes over the card via its dedup check without re-counting it).
 * Premade curriculum texts consume 1 SENTENCES quota, mirroring the batch
 * add; custom/chat texts were already paid for at creation.
 */
export const addSingleTextFromCollection = mutation({
  args: {
    textId: v.id('texts'),
  },
  returns: v.object({
    added: v.boolean(),
    alreadyAdded: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const { text, isLevelCollection } = await requireAccessibleText(
      ctx,
      args.textId,
      courseId,
      userId,
    );

    const deck = await getOrCreateDeck(ctx, course);

    const existingCard = await getCardByDeckAndText(ctx, deck._id, args.textId);
    if (existingCard) {
      // Already in the deck, just make sure no stale mark survives.
      await clearMarkForAddedText(ctx, userId, courseId, args.textId);
      return { added: false, alreadyAdded: true };
    }

    if (isLevelCollection) {
      await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, 1);
    }

    const cardsInserted = await addTextsAsCards(
      ctx, [text], deck, text.collectionId, course, userId,
    );
    if (cardsInserted > 0) {
      await updateCollectionProgress(ctx, userId, courseId, text.collectionId, {
        addedDelta: cardsInserted,
      });
      await ctx.db.patch(deck._id, { cardCount: deck.cardCount + cardsInserted });
      await maybeAutoAdvanceActiveCollection(ctx, userId, courseId, text.collectionId);
    }

    return { added: cardsInserted > 0, alreadyAdded: false };
  },
});

/**
 * Ensure content (translations + audio) exists for a specific card.
 * Called automatically when a card is displayed and has missing content.
 *
 * Deliberately NOT gated by `assertBillingCurrent` (decided 2026-07-26):
 * the ensure* endpoints are the content pipeline's self-heal path for cards
 * the user already owns, and blocking them while a payment is past due
 * would corrupt the study experience the free tier still promises. The
 * dunning block enforces at the spend boundary instead. `consumeQuota`
 * (card creation, chat, etc.), plus the app-wide overdue dialog.
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

    return scheduleMissingContent(
      ctx,
      args.textId,
      text,
      active.course.baseLanguages,
      active.course.targetLanguages,
    );
  },
});

/**
 * Query the next N upcoming cards for a given scheduling mode. The card set
 * differs by mode: `learn_new` pulls only new (non-graduated) cards via the
 * graduated index, `learnAndReview` pulls all due cards, and free play
 * (`radio`, either face) has no due filter at all. Its rotations serve by
 * round counter, so the cards to warm are each face's rotation head.
 */
async function getUpcomingCardsForMode(
  ctx: MutationCtx,
  deckId: Id<'decks'>,
  mode: SchedulingMode,
  now: number,
  filter: StudyContentFilter,
  track: SchedulingTrack,
): Promise<Doc<'cards'>[]> {
  if (mode === 'radio') {
    // Both faces: the Radio and Free Study rotations advance independently,
    // so their heads can be entirely different cards.
    //
    // Must go through `fetchFreePlayRotation`. The same selector the serving
    // queue uses. Calling the unfiltered `fetch` here warmed a different set
    // than free play actually serves for anyone on a 'course'/'custom' filter.
    const [radioHead, freeStudyHead] = await Promise.all([
      fetchFreePlayRotation(ctx, deckId, 'radio', filter, ENSURE_CONTENT_LOOKAHEAD),
      fetchFreePlayRotation(ctx, deckId, 'freeStudy', filter, ENSURE_CONTENT_LOOKAHEAD),
    ]);
    const byId = new Map<Id<'cards'>, Doc<'cards'>>();
    for (const card of [...radioHead, ...freeStudyHead]) byId.set(card._id, card);
    return [...byId.values()];
  }
  // Due queues: warm exactly what the serving path (`fetchTrackDueCards`)
  // will read, same track (shared vs writing schedule), same content-source
  // filter. Warming an unfiltered/other-track superset here looked harmless
  // but warmed a different set than the queue actually serves. The same
  // trap the free-play comment above describes.
  return fetchTrackDueCards(
    ctx,
    deckId,
    mode,
    filter,
    track,
    now,
    ENSURE_CONTENT_LOOKAHEAD,
  );
}

/**
 * Schedule missing content (translations + TTS) for the supplied due cards.
 * Shared by the per-mode (`ensureUpcomingCardsContent`) and all-modes
 * (`ensureUpcomingCardsContentAllModes`) ensure mutations. Returns the number
 * of cards that actually needed work.
 *
 * PROBE-THEN-DISPATCH: each card is first run through the sweep in read-only
 * probe mode (see ProbeNeedsWork); only cards that need work get a scheduled
 * per-card `prepareCardContent` mutation. Two properties this buys:
 *  - Steady state (nothing needy, or everything in-flight under claims) does
 *    ZERO writes, and a write-free mutation cannot lose an OCC race — the
 *    2026-08-20 permanent failure ("audioRecordings changed on every retry"
 *    vs completing TTS jobs) is structurally impossible then. It is also one
 *    single billed mutation, no per-card fan-out.
 *  - When cards DO need work, each runs in its own small transaction, so a
 *    completing job conflicts with at most that one card's mutation (cheap
 *    auto-retry) instead of killing the whole sweep.
 */
async function scheduleContentForUpcomingCards(
  ctx: MutationCtx,
  active: { settings: Doc<'userSettings'>; course: Doc<'courses'> },
  cards: Doc<'cards'>[],
): Promise<number> {
  let processed = 0;
  // Batch-load the texts up front (one concurrent read round, not one
  // sequential get per card) before the sequential probe loop.
  const texts = await Promise.all(cards.map((card) => ctx.db.get(card.textId)));
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const text = texts[i];
    if (!text) continue;
    let needsWork = false;
    try {
      await scheduleMissingContent(
        ctx,
        card.textId,
        text,
        active.course.baseLanguages,
        active.course.targetLanguages,
        { probe: true },
      );
    } catch (error) {
      if (error instanceof ProbeNeedsWork) {
        needsWork = true;
      } else {
        // A probe is read-only, so an unexpected throw is data-shaped (bad
        // config etc.) — skip this card, keep probing the rest.
        console.error('[ensureUpcomingCards] probe failed for one card — continuing', {
          textId: card.textId,
          error,
        });
      }
    }
    if (needsWork) {
      await ctx.scheduler.runAfter(0, internal.features.decks.prepareCardContent, {
        textId: card.textId,
        baseLanguages: active.course.baseLanguages,
        targetLanguages: active.course.targetLanguages,
      });
      processed++;
    }
  }

  // This sweep does NOT reach past the deck into not-yet-added collection
  // texts; that proved too late for fast reviewers (batches observed added
  // ~30s apart vs a ~15-40s per-card pipeline), so the batch add now
  // schedules `warmNextCollectionBatch` to pre-generate the next batch
  // beyond the frontier at add time. Preview browsing still generates
  // translations lazily and audio only on an explicit audio-icon click.
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

    const cards = await getUpcomingCardsForMode(
      ctx,
      deck._id,
      schedulingMode,
      Date.now(),
      settings?.studyContentFilter ?? 'both',
      schedulingTrackFromSettings({
        separateModeTracking: settings?.separateModeTracking,
        reviewMode: settings?.reviewMode,
      }),
    );

    return scheduleContentForUpcomingCards(ctx, active, cards);
  },
});

// Scheduling modes whose upcoming card sets differ for content purposes.
// Free play's rotations serve by round counter with no due filter, so its
// upcoming cards are NOT covered by the due-based modes and must be warmed
// separately (both faces, see getUpcomingCardsForMode).
const WARMABLE_SCHEDULING_MODES: SchedulingMode[] = [
  'learn_new',
  'learnAndReview',
  'radio',
];

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

    const now = Date.now();
    // Free play's rotation head is filter-dependent, so the warmer needs the
    // same content filter the serving queue reads.
    const settings = await getCourseSettings(ctx, active.course._id);
    const filter = settings?.studyContentFilter ?? 'both';
    // With separateModeTracking on, the home-screen mode toggle switches
    // between two different due queues. Warm both tracks so either choice
    // starts instantly. (Free play ignores the track; it's warmed once.)
    const tracks: SchedulingTrack[] = settings?.separateModeTracking
      ? ['shared', 'writing']
      : ['shared'];
    const cardLists = await Promise.all(
      WARMABLE_SCHEDULING_MODES.flatMap((mode) =>
        (mode === 'radio' ? (['shared'] as SchedulingTrack[]) : tracks).map(
          (track) => getUpcomingCardsForMode(ctx, deck._id, mode, now, filter, track),
        ),
      ),
    );

    // Merge + dedup by card id so overlapping cards are scheduled once.
    const byId = new Map<Id<'cards'>, Doc<'cards'>>();
    for (const list of cardLists) {
      for (const card of list) {
        if (!byId.has(card._id)) byId.set(card._id, card);
      }
    }

    return scheduleContentForUpcomingCards(ctx, active, Array.from(byId.values()));
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
    priority: v.optional(ttsPriorityValidator),
    llmPriority: v.optional(llmPriorityValidator),
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
      { priority: args.priority, llmPriority: args.llmPriority },
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
      regionVariant: v.optional(v.string()),
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
      regionVariant: row.regionVariant,
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
    /**
     * Retranslation flag. Set when this action is dispatched as the
     * Google fallback for a deliberate LLM retranslation (flagTranslation
     * or the model-swap migration). When true, the action skips the
     * "reuse existing translatedText" shortcut and Google-translates fresh,
     * then forwards the flag to `storeTranslationAndScheduleTTS` so the
     * existing row is actually overwritten. False/absent → historical
     * behavior (reuse existing translation if present).
     *
     * Failure contract: THROWS on translation/store errors. This action runs
     * as an llmPool job (both the direct Google path and the LLM fallback),
     * so the pool retries with backoff and terminal failures land in
     * `onGoogleFallbackComplete`, which logs and leaves the claim to expire
     * as a re-drive backoff.
     */
    replaceExisting: v.optional(v.boolean()),
    /**
     * Single-writer token, forwarded to `storeTranslationAndScheduleTTS` as
     * `expectedClaimId`. Set by the LLM-fallback dispatch (the claim the
     * failed LLM job owned, re-pointed at this job); absent on the direct
     * Google path, which holds no claim.
     */
    claimId: v.optional(v.id('llmTranslationClaims')),
    /**
     * Mixed-dialect pin: the `regionVariant` of a translation row deleted
     * before this regeneration was enqueued (captured pre-delete by the
     * version-stale sweep, or forwarded through the LLM fallback). Preferred
     * over a fresh `resolveMixedVariant` pick so the dialect never flips.
     */
    preferredRegionVariant: v.optional(v.string()),
    /**
     * Translation-only mode, forwarded to `storeTranslationAndScheduleTTS`
     * so the landing translation does not auto-enqueue TTS. Set by the
     * collection-preview generation path (directly or via the LLM fallback).
     */
    skipTts: v.optional(v.boolean()),
    /** TTS priority, forwarded to `storeTranslationAndScheduleTTS`. */
    priority: v.optional(ttsPriorityValidator),
    /**
     * Card-edit audit row this job resolves, forwarded from the LLM fallback
     * dispatch. Absent on the direct Google path, which no user gesture
     * triggers.
     */
    retranslationAuditId: v.optional(v.id('cardEditRetranslations')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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
    //
    // Variant pin: prefer the existing row's persisted regionVariant, then
    // the pre-delete capture (`preferredRegionVariant`), then a fresh
    // deterministic pick. Regeneration must not flip the card's dialect.
    // All three resolve to null for non-mixed targets.
    const mixed =
      (existingRow?.regionVariant
        ? getMixedVariantByRegion(args.targetLanguage, existingRow.regionVariant)
        : null) ??
      (args.preferredRegionVariant
        ? getMixedVariantByRegion(args.targetLanguage, args.preferredRegionVariant)
        : null) ??
      resolveMixedVariant(args.targetLanguage, args.textId as string);
    const translateTarget = mixed ? mixed.subCode : args.targetLanguage;
    const regionVariant = mixed?.regionVariant;

    let translation: string;
    let romanizedText: string | undefined;

    // Honor `replaceExisting`: a retranslation that fell back to Google
    // must Google-translate fresh rather than reuse the stale existing
    // translatedText, otherwise the audio would be regenerated against
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
          // 3 retries already exhausted. Persist sentinel so subsequent
          // ensureContent runs see "tried" and skip rescheduling.
          romanizedText = '';
        }
      } else {
        romanizedText = existingRow!.romanizedText;
      }
    } else {
      // Post-process before romanization so the derived romanizedText is
      // computed from the cleaned text.
      const translateStartedAt = Date.now();
      translation = postProcessTranslation(
        translateTarget,
        await translateText(args.text, args.sourceLanguage, translateTarget),
      );
      // Google bills per character of source text. This is the final fallback
      // after the LLM stage chain has given up, so its volume doubles as a
      // health signal for the LLM translation pipeline.
      await captureGeneration(ctx, {
        feature: 'machine_translation',
        model: 'google-translate-v2',
        provider: 'google',
        latencyMs: Date.now() - translateStartedAt,
        costUsd: costForCharacters('googleTranslate', args.text.length),
        sharedContent: true,
        extra: {
          text_id: args.textId,
          target_language: translateTarget,
          character_count: args.text.length,
        },
      });
      if (ROMANIZATION_LANGUAGES.has(translateTarget)) {
        try {
          romanizedText = await romanizeText(translation, translateTarget);
        } catch (err) {
          // 3 retries already exhausted. Persist the empty-string
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
        replaceExisting: args.replaceExisting,
        speakerGender: asVoiceGender(args.audioSpeakerGender),
        expectedClaimId: args.claimId,
        skipTts: args.skipTts,
        priority: args.priority,
        retranslationAuditId: args.retranslationAuditId,
      },
    );

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
    /**
     * Retranslation flag. Set by callers that deliberately want to overwrite
     * an existing translation. Today only `flagTranslation` (the user
     * reported a bad translation and we want the new LLM output to replace
     * the displayed text).
     *
     * When `true` AND a translation row already exists, the mutation
     * replaces `translatedText`, `romanizedText` (matched with its source),
     * `translationSource`, and `regionVariant`. `flagCount` is preserved.
     * It tracks user dissatisfaction history. The audio decision also lives
     * HERE (not in retranslation callers): when the new text sounds
     * identical to the old (punctuation/'_'-only diff, `soundsSame`), the
     * existing audio rows are kept and no TTS is enqueued; otherwise the
     * stale audio rows are deleted so the no-audio guard below schedules a
     * fresh TTS. Callers must NOT delete audio up front, before the LLM
     * lands they can't know whether the change is audible.
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
     * The card's resolved `audioSpeakerGender`. Persisted on the translation
     * row so the gender-mismatch sweep in `scheduleMissingContent` can
     * invalidate translations whose grammar no longer agrees with the card's
     * current voice gender. Optional during rollout so old call sites that
     * haven't been threaded yet still compile.
     */
    speakerGender: v.optional(voiceGenderValidator),
    /**
     * Single-writer token: the `llmTranslationClaims` row the calling job was
     * enqueued under. When supplied, the write only proceeds if that exact
     * claim doc still exists. A reclaim deletes + reinserts the claim under
     * a new `_id`, so a mismatch means another job now owns this
     * (textId, targetLanguage) and this result is stale. Absent on the
     * claimless direct-Google path (`scheduleMissingContent`'s non-openrouter
     * branch), which then keeps its historical no-overwrite semantics only.
     */
    expectedClaimId: v.optional(v.id('llmTranslationClaims')),
    /**
     * Translation-only mode: store the translation but do NOT auto-enqueue
     * TTS, UNLESS a card references this text. Used by the collection-preview
     * generation path, where audio for preview-only texts is deliberately
     * deferred to an explicit audio-icon click. The card check closes a
     * pipeline hole: a text can become a card while its skipTts warm job is
     * in flight (onboarding seeds racing the collection warms), and the
     * concurrent ensure sweep defers TTS to this very job via the fresh LLM
     * claim, so honoring skipTts unconditionally left the card with a
     * translation and no audio, forever. Absent/false → historical behavior
     * (translation landing schedules its TTS).
     */
    skipTts: v.optional(v.boolean()),
    /**
     * Priority for the TTS enqueue below (see ttsPriorityValidator).
     * Threaded from the enqueue that carried the translation job so audio
     * lands in the tier the content was requested at.
     */
    priority: v.optional(ttsPriorityValidator),
    /**
     * The `cardEditRetranslations` row this write resolves, when the job was
     * triggered by a user gesture (a flag, or a manual edit of a curriculum
     * translation). This mutation is the only place that knows which of its
     * outcomes an attempt reached, so it owns the resolution. Absent on every
     * ordinary fill, which is the overwhelming majority of calls.
     */
    retranslationAuditId: v.optional(v.id('cardEditRetranslations')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Guard: the text may have been cascade-deleted (deleteCardPermanently /
    // editCard cleanup) while this job was in flight. Don't write an orphan
    // translation row (and schedule orphan TTS) against a now-deleted text.
    // The LLM claim (if any) is released by the pool job's onComplete.
    // No-op in normal flow (text always exists).
    const text = await ctx.db.get(args.textId);
    if (text === null) {
      await resolveRetranslation(
        ctx,
        args.retranslationAuditId,
        'dropped_text_deleted',
      );
      return null;
    }

    // Single-writer gate: a job whose claim was reclaimed mid-flight (it ran
    // past CLAIM_STALE_MS and a concurrent scheduler re-enqueued the row) must
    // not write. The reclaiming job owns the row now, and a late stale result
    // landing after the owner's would silently revert it (worst case: a
    // flag-retranslation's text overwritten while its audio survives).
    if (args.expectedClaimId !== undefined) {
      const llmClaim = await getLlmClaim(ctx, args.textId, args.targetLanguage);
      if (llmClaim?._id !== args.expectedClaimId) {
        await resolveRetranslation(
          ctx,
          args.retranslationAuditId,
          'dropped_superseded',
        );
        return null;
      }
    }

    const existing = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();

    // Backstop at the write choke point: no job may overwrite existing wording
    // on a user-created card, whatever enqueued it. Callers already refuse to
    // ask (`flagTranslation` short-circuits on user-created texts, and
    // `updateEssentialGreetings` only targets premade rows), so no live path
    // reaches this today. It is defence in depth against a future caller.
    //
    // Deliberately scoped to the OVERWRITE. The `existing &&` is load-bearing,
    // and NOT for the fill-a-missing-language path: that one never sets
    // `replaceExisting` (see `scheduleTranslationForLanguage`), so the guard is
    // inert there either way. It matters for `onGoogleFallbackComplete`, which
    // forwards the original job's `replaceExisting: true` into a re-enqueue,
    // by the time that lands, the row it meant to replace may have been swept,
    // and refusing then would leave the card with no translation at all.
    if (existing && args.replaceExisting && isUserCreatedText(text)) {
      await resolveRetranslation(
        ctx,
        args.retranslationAuditId,
        'refused_user_created',
      );
      return null;
    }

    // Choke-point post-processing (idempotent, LLM/Google producers already
    // apply it upstream; this catches any path that didn't). The empty-string
    // romanization sentinel maps to itself, so "tried, failed" survives.
    const translatedText = postProcessTranslation(
      args.targetLanguage,
      args.translatedText,
    );
    const romanizedText =
      args.romanizedText !== undefined
        ? postProcessTranslation(args.targetLanguage, args.romanizedText)
        : undefined;

    // Set in the replaceExisting branch when the retranslation is a
    // punctuation-only change. Audio is kept and TTS must not be enqueued.
    let audioUnchangedBySound = false;

    // Set when this write changed content that belongs in the cards'
    // searchableText (new/replaced translation, newly-filled romanization).
    // Triggers the batched rebuild fan-out below.
    let searchableContentChanged = false;

    // Set when the row ends this mutation without an IPA transcription
    // (fresh insert, replace-cleared, or a legacy row that never had one).
    // IPA can't be computed inline here: espeak lives in the Node runtime
    // (convex/features/ipa.ts), so it's scheduled as a follow-up below.
    // Assigned by every branch of the insert/replace/fill structure.
    let ipaMissingAfterWrite: boolean;
    // Same contract for furigana: like IPA it is Node-runtime compute
    // (convex/features/furigana.ts), so a replace must clear the pair here
    // and schedule regeneration below — leaving the old wording's furigana
    // on the new text would park a stale annotation the lazy pipeline never
    // revisits (non-undefined) and the client always rejects.
    let furiganaMissingAfterWrite: boolean;

    if (!existing) {
      await ctx.db.insert('translations', {
        textId: args.textId,
        targetLanguage: args.targetLanguage,
        translatedText,
        // `!== undefined` so the empty-string sentinel ("tried, failed,
        // leave empty") persists on the new row and ensureContent stops
        // rescheduling, otherwise `romanizedText === ''` would be
        // dropped by the truthy spread and look like "never attempted".
        ...(romanizedText !== undefined
          ? {
            romanizedText,
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
        // Freshly produced row → stamp the language's current method version.
        translationVersion: getCurrentTranslationVersion(args.targetLanguage),
      });
      searchableContentChanged = true;
      ipaMissingAfterWrite = true;
      furiganaMissingAfterWrite = true;
      // A retranslation whose row vanished under it (a sweep deleted it while
      // the job was in flight). The new wording still landed, so it counts as
      // applied; there is simply no `before` to have kept audio for.
      await resolveRetranslation(ctx, args.retranslationAuditId, 'applied', {
        afterText: translatedText,
        afterTranslationSource: args.translationSource,
      });
    } else if (args.replaceExisting) {
      // Audio decision for retranslations, made here where old and new text
      // are both in hand: a punctuation/'_'-only change sounds identical, so
      // the existing audio stays valid, deleting + regenerating would spend
      // real TTS cost on byte-identical speech. Only an audible change drops
      // the language's audio rows (all voices, reference-aware).
      audioUnchangedBySound = soundsSame(existing.translatedText, translatedText);
      if (!audioUnchangedBySound) {
        // keepAsset: a retranslation is a content change. The old recording
        // is still correct audio of the old sentence and stays cached.
        await deleteAudioRowsForTextLanguage(
          ctx,
          args.textId,
          args.targetLanguage,
          { keepAsset: true },
        );
      }

      // Deliberate retranslation: overwrite the translation and its matched
      // metadata. romanizedText and romanizationSource travel as a unit,
      // both replaced together, including the empty-string sentinel. If the
      // caller didn't compute a new romanization (`romanizedText` undefined),
      // clear both fields so the next ensureContent pass regenerates them
      // against the new translatedText.
      const patch: Partial<{
        translatedText: string;
        romanizedText: string | undefined;
        romanizationSource: string | undefined;
        ipaText: string | undefined;
        ipaSource: string | undefined;
        furiganaText: string | undefined;
        furiganaSource: string | undefined;
        translationSource: string | undefined;
        regionVariant: string | undefined;
        speakerGender: 'male' | 'female';
        translationVersion: number;
      }> = {
        translatedText,
        // A retranslation is freshly produced → stamp the current method version.
        translationVersion: getCurrentTranslationVersion(args.targetLanguage),
      };
      if (romanizedText !== undefined) {
        patch.romanizedText = romanizedText;
        patch.romanizationSource = args.romanizationSource;
      } else {
        // Convex `patch` semantics: `undefined` clears the field.
        patch.romanizedText = undefined;
        patch.romanizationSource = undefined;
      }
      // No caller computes IPA inline (Node-runtime engine), so a replaced
      // translation always clears the pair; the follow-up scheduled below
      // regenerates it against the new wording.
      patch.ipaText = undefined;
      patch.ipaSource = undefined;
      ipaMissingAfterWrite = true;
      // Furigana: same reasoning as IPA, same follow-up.
      patch.furiganaText = undefined;
      patch.furiganaSource = undefined;
      furiganaMissingAfterWrite = true;
      if (args.translationSource) {
        patch.translationSource = args.translationSource;
      }
      if (args.regionVariant) {
        patch.regionVariant = args.regionVariant;
      }
      // Update the recorded speakerGender. A retranslation is what fixes a
      // stale gender, so the new row's gender should reflect the current card.
      if (args.speakerGender) {
        patch.speakerGender = args.speakerGender;
      }
      await ctx.db.patch(existing._id, patch);
      searchableContentChanged = true;
      // The outcome a reviewer is actually after: what the model produced, and
      // whether it differed audibly enough to be worth re-synthesizing.
      await resolveRetranslation(
        ctx,
        args.retranslationAuditId,
        audioUnchangedBySound ? 'applied_audio_kept' : 'applied',
        {
          afterText: translatedText,
          afterTranslationSource: args.translationSource,
        },
      );
    } else {
      const patch: Partial<{
        romanizedText: string;
        romanizationSource: string;
        translationSource: string;
        regionVariant: string;
        speakerGender: 'male' | 'female';
        translationVersion: number;
      }> = {};
      // Same `!== undefined` reasoning: persist the sentinel on first write
      // but never overwrite a previously-stored real value. Source travels
      // with the value. They're written/cleared as a unit.
      if (
        romanizedText !== undefined &&
        existing.romanizedText === undefined
      ) {
        patch.romanizedText = romanizedText;
        if (args.romanizationSource) {
          patch.romanizationSource = args.romanizationSource;
        }
      }
      // Translation source is set on first-write of `translatedText` (which
      // happened upstream when the row was inserted). For existing rows we
      // only fill it in if it's missing. The legacy-backfill migration
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
      // Fill-if-missing: stamp legacy rows (written before the field existed) at
      // BASELINE, not the current version. This branch keeps the row's OLD
      // translatedText, so it must stay regenerable by a future translationVersion
      // bump, matching the one-time content-version backfill, which stamped
      // legacy rows at v1 so `baseline < bumped = stale`. Stamping the current
      // version here would mark
      // stale content as already up-to-date and silently defeat the bump. Only the
      // insert and replaceExisting branches (fresh content) stamp the current version.
      if (existing.translationVersion === undefined) {
        patch.translationVersion = DEFAULT_CONTENT_VERSION;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
        // Only a real romanization value changes the search string. The
        // metadata fills (source/variant/gender/version) don't, and the
        // empty-string sentinel is filtered out of searchableText anyway.
        if (patch.romanizedText) {
          searchableContentChanged = true;
        }
      }
      // Legacy row this job merely filled metadata on: schedule IPA only
      // when the row never had one (`=== undefined` honors the sentinel).
      ipaMissingAfterWrite = existing.ipaText === undefined;
      furiganaMissingAfterWrite = existing.furiganaText === undefined;
      // Unreachable for audit-carrying jobs today (they all set
      // `replaceExisting`), but the args are independent, so close the
      // outcome matrix: an attempt that landed here did NOT overwrite the
      // row, and leaving its audit row 'enqueued' would read as "still in
      // flight" in the admin QC view forever. Guarded so a resolved row is
      // never downgraded.
      await resolveRetranslationIfPending(
        ctx,
        args.retranslationAuditId,
        'dropped_superseded',
      );
    }

    if (searchableContentChanged) {
      await scheduleSearchableTextRebuild(ctx, args.textId);
    }

    // Follow-up IPA transcription. Deliberately BEFORE the
    // `audioUnchangedBySound` early-return: a sounds-the-same retranslation
    // still changed the wording, and the replace branch just cleared the
    // pair. Harmless to race the ensureContent gate; the store mutation's
    // `=== undefined` guard makes the second write a no-op.
    if (ipaMissingAfterWrite && IPA_LANGUAGES.has(args.targetLanguage)) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.ipa.processIpaForTranslation,
        {
          textId: args.textId,
          text: translatedText,
          language: args.targetLanguage,
        },
      );
    }
    if (
      furiganaMissingAfterWrite &&
      FURIGANA_LANGUAGES.has(args.targetLanguage)
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.furigana.processFuriganaForTranslation,
        {
          textId: args.textId,
          text: translatedText,
          language: args.targetLanguage,
        },
      );
    }

    // `audioUnchangedBySound`: the retained audio row already serves this
    // (text, language), skip outright.
    if (audioUnchangedBySound) {
      return null;
    }
    let ttsPriority = args.priority;
    if (args.skipTts) {
      // skipTts means "don't spend synthesis on texts nobody studies". A
      // card referencing this text disproves that premise (see the arg's
      // docstring for the race this closes), so only skip when none exists.
      const cardForText = await ctx.db
        .query('cards')
        .withIndex('by_textId', (q) => q.eq('textId', args.textId))
        .first();
      if (!cardForText) {
        return null;
      }
      // The card also disproves "nobody is waiting on this": this is audio
      // the race left missing on a studied card, so it rides the interactive
      // pool even though the warm caller requested 'background'.
      ttsPriority = undefined;
    }

    const existingAudio = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.targetLanguage),
      )
      .first();

    if (!existingAudio) {
      // A translation just landed. Check the content-addressed store before
      // spending synthesis: another text with this exact string (same
      // language, gender, dialect) may already have fresh audio, in which
      // case attaching the pointer is all that's needed. Any drift the
      // existing-audio skip above leaves behind (e.g. a stale gender) is the
      // sweep's job, which reads through the same asset payload.
      const voiceGender = getVoiceGenderByApiCode(args.voiceName);
      const asset =
        voiceGender !== undefined
          ? await findReusableAudioAsset(ctx, {
            language: args.targetLanguage,
            voiceGender,
            regionVariant: args.regionVariant,
            spokenText: translatedText,
          })
          : null;
      if (asset) {
        await upsertAudioPointer(
          ctx,
          args.textId,
          args.targetLanguage,
          asset._id,
        );
      } else {
        const claimed = await claimTtsIfAvailable(ctx, args.textId, args.targetLanguage, ttsPriority);
        if (claimed) {
          await enqueueTtsForVoice(ctx, {
            textId: args.textId,
            text: translatedText,
            language: args.targetLanguage,
            voiceName: args.voiceName,
            regionVariant: args.regionVariant,
            priority: ttsPriority,
          });
        }
      }
    }

    return null;
  },
});

/**
 * Internal action to romanize a source text (in the texts table).
 * (The IPA sibling lives in convex/features/ipa.ts: espeak needs the Node
 * runtime; both write through the generic store mutations below.)
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
    await ctx.runMutation(internal.features.decks.storeSourceAnnotation, {
      textId: args.textId,
      kind: 'romanization',
      value: romanized,
      source: getRomanizationSource(args.language),
      forText: args.text,
    });
    return null;
  },
});

/**
 * Internal mutation to store an annotation (romanization or IPA) on a
 * source text document.
 *
 * Idempotent against a real-value race: only patches when the row hasn't
 * been written yet (`=== undefined` on the kind's value field). The
 * empty-string sentinel for "tried and failed" also wins on first write but
 * never overwrites a previously-stored real value. `source` is recorded so
 * a future strategy swap can find + invalidate the row.
 */
export const storeSourceAnnotation = internalMutation({
  args: {
    textId: v.id('texts'),
    kind: vAnnotationKind,
    value: v.string(),
    source: v.string(),
    // The text the annotation was computed FROM. The row's wording can change
    // between the action reading it and this mutation running (a backfill
    // racing a retranslation); a mismatched annotation must not land — the
    // field stays undefined so the lazy pipeline regenerates against the
    // current wording. Optional only for in-flight jobs enqueued before the
    // field existed. Mirror of `forText` in storeApprovalEntryFurigana.
    forText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const spec = TEXT_ANNOTATIONS[args.kind];
    const text = await ctx.db.get(args.textId);
    if (args.forText !== undefined && text && text.text !== args.forText) {
      return null;
    }
    if (text && text[spec.textField] === undefined) {
      const patch: Partial<Record<AnnotationField, string>> = {};
      patch[spec.textField] = args.value;
      patch[spec.sourceField] = args.source;
      await ctx.db.patch(args.textId, patch);
      // A newly-landed value belongs in the cards' search string only for
      // kinds users actually type (romanization; not IPA), and the
      // empty-string "tried, failed" sentinel never does.
      if (spec.inSearchableText && args.value !== '') {
        await scheduleSearchableTextRebuild(ctx, args.textId);
      }
    }
    return null;
  },
});

/**
 * Internal action to romanize an existing translation (backfill).
 * (IPA sibling: processIpaForTranslation in convex/features/ipa.ts.)
 */
export const processRomanizationForTranslation = internalAction({
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
      console.error(
        'Translation romanization error (persisting sentinel):',
        err,
      );
      romanized = '';
    }
    // Source recorded even on failure: lets a strategy swap target failed
    // rows by the source that produced the sentinel.
    await ctx.runMutation(internal.features.decks.storeTranslationAnnotation, {
      textId: args.textId,
      language: args.language,
      kind: 'romanization',
      value: romanized,
      source: getRomanizationSource(args.language),
      forText: args.text,
    });
    return null;
  },
});

/**
 * Internal mutation to store an annotation (romanization or IPA) on a
 * translation document. Same idempotence + sentinel + source semantics as
 * `storeSourceAnnotation` above.
 */
export const storeTranslationAnnotation = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    kind: vAnnotationKind,
    value: v.string(),
    source: v.string(),
    // See storeSourceAnnotation: skip when the row's wording moved on.
    forText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const spec = TEXT_ANNOTATIONS[args.kind];
    const translation = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.language),
      )
      .first();
    if (
      args.forText !== undefined &&
      translation &&
      translation.translatedText !== args.forText
    ) {
      return null;
    }
    if (translation && translation[spec.textField] === undefined) {
      const patch: Partial<Record<AnnotationField, string>> = {};
      patch[spec.textField] = args.value;
      patch[spec.sourceField] = args.source;
      await ctx.db.patch(translation._id, patch);
      // See storeSourceAnnotation: only searchable kinds with a real value.
      if (spec.inSearchableText && args.value !== '') {
        await scheduleSearchableTextRebuild(ctx, args.textId);
      }
    }
    return null;
  },
});

const REBUILD_SEARCHABLE_BATCH = 50;

/**
 * Content lands in bursts. A text gets its translations and romanizations
 * for every course language within seconds, and each store used to schedule
 * its own full rebuild over every card referencing the text (premade texts
 * are shared across all users' decks, so one burst multiplied into thousands
 * of redundant card patches). Debounce: one pending rebuild per text,
 * marked on the text row; stores inside the window piggyback on it (the
 * rebuild reads content at run time, so it picks up everything the burst
 * wrote).
 */
const SEARCHABLE_REBUILD_DEBOUNCE_MS = 10_000;

async function scheduleSearchableTextRebuild(
  ctx: MutationCtx,
  textId: Id<'texts'>,
): Promise<void> {
  const text = await ctx.db.get(textId);
  if (!text) return;
  const now = Date.now();
  if (
    text.searchableRebuildScheduledAt !== undefined &&
    text.searchableRebuildScheduledAt > now
  ) {
    return;
  }
  await ctx.db.patch(textId, {
    searchableRebuildScheduledAt: now + SEARCHABLE_REBUILD_DEBOUNCE_MS,
  });
  await ctx.scheduler.runAfter(
    SEARCHABLE_REBUILD_DEBOUNCE_MS,
    internal.features.decks.rebuildSearchableTextForText,
    { textId },
  );
}

/**
 * Rebuild `searchableText` on every card referencing a text, in batches with
 * self-continuation.
 *
 * Scheduled by the three late-content write funnels
 * (`storeTranslationAndScheduleTTS`, `storeSourceAnnotation`,
 * `storeTranslationAnnotation`) so search stays correct for content that
 * lands AFTER a card was created. The review-time staleness check in
 * `reviewCard` only compares language sets. It misses retranslations and
 * late romanization fills entirely, and only fires when the card is actually
 * reviewed, so it stays as a backstop, not the primary path.
 *
 * The rebuilt string depends only on (textId, course languages), so it is
 * computed once per distinct language list and reused across the batch;
 * unchanged cards are skipped so repeated triggers stay cheap.
 */
export const rebuildSearchableTextForText = internalMutation({
  args: {
    textId: v.id('texts'),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Text may have been cascade-deleted while this job was queued.
    const text = await ctx.db.get(args.textId);
    if (!text) return null;

    // First batch: release the debounce marker so content landing from here
    // on schedules a fresh rebuild (this run reads content as of now).
    if (args.cursor === undefined && text.searchableRebuildScheduledAt !== undefined) {
      await ctx.db.patch(args.textId, {
        searchableRebuildScheduledAt: undefined,
      });
    }

    const page = await ctx.db
      .query('cards')
      .withIndex('by_textId', (q) => q.eq('textId', args.textId))
      .paginate({
        numItems: REBUILD_SEARCHABLE_BATCH,
        cursor: args.cursor ?? null,
      });

    // Shared per-page caches: deck→languages resolved once per deck, built
    // strings memoized per (textId, languages), every card here shares one
    // text, so the build runs once per distinct language list.
    const caches = {
      deckLanguages: new Map<Id<'decks'>, string[] | null>(),
      built: new Map<
        string,
        { searchableText: string; searchableTextLanguages: string[] }
      >(),
    };

    for (const card of page.page) {
      const built = await buildSearchableTextPatchForCard(ctx, card, text, caches);
      if (built) {
        // Raw `db.patch`, NOT `patchCard`. None of the four card aggregates
        // key on `searchableText` / `searchableTextLanguages` (they key on
        // deckId, dueDate, the state label and collectionOrigin), so
        // `patchCard`'s unconditional `replaceOrInsert` would do four btree
        // delete+inserts per card that reproduce a byte-identical entry.
        // That is not just wasted work: aggregate internal nodes are a write
        // -contention hotspot, and this job fans out over every card for the
        // text across every user. `migrations.ts:rebuildCardSearchableText`
        // bypasses them for the identical write for the same reason.
        await ctx.db.patch(card._id, built);
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.decks.rebuildSearchableTextForText,
        { textId: args.textId, cursor: page.continueCursor },
      );
    }
    return null;
  },
});

/**
 * Internal mutation to store freshly synthesized audio: upserts the shared
 * content-addressed `audioAssets` row for (language, voiceGender,
 * regionVariant, spokenText) and points this text's `audioRecordings` row at
 * it. When the asset already exists, a completed synthesis replaces its audio
 * IN PLACE. Every text sharing the string gets the new audio on its next
 * query refresh, while a mid-flight attempt-0 write against completed audio
 * only attaches the pointer and drops its own blob (see `upsertAudioAsset`).
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
    // The RAW string this audio speaks (asset key material), `text.text` for
    // source-language audio, the translation's `translatedText` otherwise.
    spokenText: v.string(),
    // Dialect pin for mixed-language rows; part of the asset key.
    regionVariant: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Guard: the text may have been cascade-deleted (deleteCardPermanently /
    // editCard cleanup) while this TTS job was in flight. Don't write an orphan
    // audio row against a deleted text; drop the freshly-stored blob (reference-
    // safe, so a shared blob is left untouched) so it isn't leaked. No-op in
    // normal flow (text always exists).
    if ((await ctx.db.get(args.textId)) === null) {
      await deleteStorageBlobIfUnreferenced(ctx, args.storageId);
      return null;
    }

    // Guard: never point an asset at a blob that no longer exists. A cleanup
    // can collect a long-running job's stored blob before this write lands;
    // writing anyway births a dead asset that looks valid ('validated', doc
    // intact) but serves a null URL. Skipping is safe: the claim releases
    // via onComplete and the next ensure sweep re-drives the language.
    if ((await ctx.db.system.get(args.storageId)) === null) {
      console.error(
        '[storeAudioRecording] blob already deleted — refusing to write a dead asset',
        { textId: args.textId, language: args.language, storageId: args.storageId },
      );
      return null;
    }

    const result = await upsertAudioAsset(
      ctx,
      {
        language: args.language,
        voiceGender: args.voiceGender,
        regionVariant: args.regionVariant,
        spokenText: args.spokenText,
      },
      {
        storageId: args.storageId,
        voiceName: args.voiceName,
        ttsProvider: args.ttsProvider,
        ttsQuality: args.ttsQuality,
        speed: args.speed,
        wordTimings: args.wordTimings,
        // Freshly synthesized audio is always produced under the language's
        // CURRENT TTS setup, so stamp the current ttsVersion unconditionally.
        ttsVersion: getCurrentTtsVersion(args.language),
      },
    );
    await upsertAudioPointer(ctx, args.textId, args.language, result.assetId);

    if (result.outcome === 'kept') {
      // The asset already carries completed audio and this was a mid-flight
      // 'unknown' write. The incoming blob is unused BY THE ASSET — but the
      // job that stored it is still running and will reference this very
      // blob in its final (completed) write, which replaces the asset. An
      // immediate delete here killed that blob under the running job, and
      // the final write then either birthed a dead asset (pre blob-guard)
      // or was refused, looping forever. Delayed + reference-checked: if
      // the final write lands the blob into the asset it survives, if the
      // job dies or goes elsewhere it is collected.
      await scheduleBlobSwapDelete(ctx, args.storageId);
    } else if (result.replacedStorageId !== null) {
      // In-place swap: the old blob stays downloadable for a grace window so
      // clients holding a just-issued signed URL don't 404 mid-listen.
      await scheduleBlobSwapDelete(ctx, result.replacedStorageId);
    }
    return null;
  },
});
