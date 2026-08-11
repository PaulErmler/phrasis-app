import { v, Infer } from 'convex/values';
import { vOnCompleteArgs } from '@convex-dev/workpool';
import {
  internalAction,
  internalMutation,
  ActionCtx,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';
import {
  synthesizeSpeech,
  transcribeAudio,
  reserveAzureSttSlot,
  type WordTiming,
} from './tts';
import { languageSupportsStt } from '../../lib/languages';
import { textsMatchForLanguage } from '../lib/textComparison';
import {
  textsMatchSemantic,
  type SemanticValidationTelemetry,
} from '../lib/ttsSemanticValidation';
import { captureGeneration } from '../lib/posthogAi';
import { costForAudioMs, costForCharacters } from '../config/aiCosts';
import { OPENROUTER_MODELS } from '../config/aiModels';
import { deleteStorageBlobIfUnreferenced } from '../lib/audio';
import { BLOB_SWAP_DELETE_DELAY_MS } from '../lib/audioAssets';
import { TTS_RATE_LIMIT_BY_PROVIDER } from '../rateLimiter';
import { reserveRateLimitToken } from '../lib/rateLimitReserve';
import { ttsPool } from '../lib/workpools';
import {
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
} from '../types';
import type { TtsProvider, VoiceGender } from '../types';

/**
 * TTS pipeline, built on the `ttsPool` workpool (convex/lib/workpools.ts).
 * Per audio row:
 *
 *   1. `claimTtsIfAvailable` (called by scheduling mutations) atomically
 *      reserves the (textId, language) slot.
 *   2. `enqueueTtsJob` enqueues `processTTSForCard` into the pool and stamps
 *      the pool's workId onto the claim — the claim now lives exactly as long
 *      as the pool job.
 *   3. The worker synthesizes + validates. Provider request pacing happens
 *      here: every synthesis reserves a token from the provider's bucket
 *      (`reserveRateLimitToken`), so validation re-synthesis is metered too.
 *      On any failure (429s included) the worker THROWS and the pool retries
 *      with jittered exponential backoff.
 *   4. `onTtsJobComplete` (guaranteed on success, failure, and cancellation)
 *      releases the claim.
 */

const MAX_TTS_VALIDATION_ATTEMPTS = 2;

/**
 * Per-(textId, language) TTS claim freshness window. The claim is released by
 * the pool job's onComplete (guaranteed), so staleness is only a catastrophic
 * backstop — e.g. the onComplete handler itself failing. Generous on purpose:
 * a pool job (retries included) can legitimately run for minutes, and a
 * premature "stale" verdict makes a concurrent `scheduleMissingContent`
 * double-enqueue the same synthesis.
 */
const TTS_CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Longest synthesis-token refill wait a worker rides out in-place. This MUST
 * sit below the worst full-pool wait (24 workers stacked on the slowest
 * bucket, 150/min, project ~10s) or the throw path is unreachable and a
 * single saturated provider parks sleeping workers on all 24 shared slots,
 * starving the other providers' jobs queued behind it. At 5s one bucket can
 * pin at most ~rate×5s slots (google ~12, gemini ~15, azure ~16); workers
 * past that threshold throw, free their slot, and the pool's backoff retries.
 */
const TTS_TOKEN_MAX_WAIT_MS = 5_000;

/**
 * Longest azureStt refill wait a caller rides out before an STT call
 * (validation roundtrip, word-timing backfill). Deliberately looser than the
 * synthesis cap: a mid-validation throw wastes the synthesis that just
 * happened, and in-pool demand alone can only project ~7s (24 workers on a
 * 200/min bucket) — so 15s never fires on ordinary pool contention and only
 * trips when out-of-pool consumers (backfills, chat voice) genuinely
 * oversubscribe the bucket, which previously slept workers indefinitely.
 */
const STT_TOKEN_MAX_WAIT_MS = 15_000;

/** Point-read the (textId, language) TTS generation claim, if any. */
async function getTtsClaim(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<Doc<'ttsGenerationClaims'> | null> {
  return await ctx.db
    .query('ttsGenerationClaims')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .first();
}

/**
 * Atomically check-and-insert a TTS generation claim. Returns the new claim's
 * `_id` iff the caller acquired the claim (and should enqueue the job), or
 * null when a fresh claim already exists (another mutation already scheduled
 * this work). Claims older than `TTS_CLAIM_STALE_MS` are reclaimed.
 *
 * Must be called inside a mutation context so Convex OCC prevents duplicates.
 */
export async function claimTtsIfAvailable(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<Id<'ttsGenerationClaims'> | null> {
  const existing = await getTtsClaim(ctx, textId, language);

  if (existing) {
    if (Date.now() - existing.claimedAt < TTS_CLAIM_STALE_MS) {
      return null;
    }
    await ctx.db.delete(existing._id);
  }

  return await ctx.db.insert('ttsGenerationClaims', {
    textId,
    language,
    claimedAt: Date.now(),
  });
}

/**
 * True when a non-stale TTS claim exists for this text+language (generation in flight).
 * Used to avoid deleting `audioRecordings` rows while `processTTSForCard` is running.
 */
export async function hasActiveTtsClaim(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<boolean> {
  const existing = await getTtsClaim(ctx, textId, language);
  if (!existing) return false;
  return Date.now() - existing.claimedAt < TTS_CLAIM_STALE_MS;
}

/**
 * Synthesize speech, transcribe it back, and compare to the original.
 * Retries up to `maxAttempts` times, storing each attempt's audio and
 * logging mismatches. Returns whether the final audio was validated and the
 * last stored blob id (for upserting the DB row if it was removed mid-flight).
 *
 * EVERY synthesis reserves a provider token first — including validation
 * re-synthesis, which used to run unmetered and pushed real request rates
 * above the configured budgets (the source of provider 429 bursts).
 */
async function synthesizeAndValidate(
  ctx: ActionCtx,
  args: {
    textId: Id<'texts'>;
    text: string;
    language: string;
    voiceName: string;
    provider: TtsProvider;
    voiceGender: VoiceGender;
    speed: number;
    /**
     * Azure STT locale (e.g. `'es-US'`) when the row's language is a
     * mixed-dialect code whose concrete variant was chosen at translation
     * time. Forwarded to `transcribeAudio` so language-ID is skipped and STT
     * runs against the same locale the voice was synthesized in. Undefined
     * for non-mixed languages.
     */
    regionVariant?: string;
    /**
     * Forced regeneration (regenerateCardAudio). Skips the attempt-0 early
     * write: the shared `audioAssets` row for this string already carries
     * completed audio, and it must keep playing untouched until the final
     * write swaps it — mid-flight 'unknown' churn on shared audio would
     * degrade every other text pointing at the asset.
     */
    forceRegen?: boolean;
  },
  maxAttempts: number,
): Promise<{
  validated: boolean;
  lastStorageId: Id<'_storage'> | null;
  wordTimings: WordTiming[] | null;
}> {
  // Azure Fast Transcription is the only STT backend; if it doesn't speak
  // this language, the validation loop is pure waste (every attempt 400s,
  // every retry re-synthesizes). Synthesize once, accept it, and skip
  // straight to unvalidated — wordTimings are unavailable here too.
  const canValidate = languageSupportsStt(args.language);

  const rateLimitName =
    TTS_RATE_LIMIT_BY_PROVIDER[args.provider] ?? 'googleTts';

  let lastStorageId: Id<'_storage'> | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await reserveRateLimitToken(ctx, rateLimitName, {
      maxWaitMs: TTS_TOKEN_MAX_WAIT_MS,
    });
    const synthStartedAt = Date.now();
    const blob = await synthesizeSpeech(
      args.text,
      args.voiceName,
      args.speed,
      args.provider,
      args.language,
    );
    // Google bills per character of input text, so the cost is exactly
    // derivable. Gemini TTS goes through OpenRouter, whose per-request cost is
    // only retrievable by a follow-up lookup on the generation id — recorded
    // here without a cost figure so the call volume is at least visible, and
    // flagged so a zero can't be mistaken for "free".
    await captureGeneration(ctx, {
      feature: 'tts_synthesis',
      model: args.voiceName,
      provider: args.provider,
      latencyMs: Date.now() - synthStartedAt,
      costUsd:
        args.provider === 'google'
          ? costForCharacters('googleTts', args.text.length)
          : undefined,
      sharedContent: true,
      extra: {
        text_id: args.textId,
        language: args.language,
        character_count: args.text.length,
        attempt,
        cost_source: args.provider === 'google' ? 'rate_table' : 'unavailable',
      },
    });
    const storageId: Id<'_storage'> = await ctx.storage.store(blob);
    lastStorageId = storageId;

    if (attempt === 0 && !args.forceRegen) {
      await ctx.runMutation(internal.features.decks.storeAudioRecording, {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId,
        ttsQuality: 'unknown' as const,
        ttsProvider: args.provider,
        voiceGender: args.voiceGender,
        speed: args.speed,
        spokenText: args.text,
        regionVariant: args.regionVariant,
      });
    } else if (attempt > 0) {
      await ctx.runMutation(
        internal.features.ttsProcessing.updateAudioRecordingQuality,
        {
          textId: args.textId,
          language: args.language,
          ttsQuality: 'unknown' as const,
          storageId,
          preserveOldStorage: true,
        },
      );
    }

    if (!canValidate) {
      return { validated: false, lastStorageId, wordTimings: null };
    }

    // Backpressure, not an STT failure — kept OUTSIDE the try/catch below so
    // a saturated azureStt bucket throws out of the worker (the pool's
    // backoff retries the whole job once the bucket drains) instead of being
    // swallowed as a transcription error and accepting unvalidated audio
    // over a transient queue spike.
    await reserveAzureSttSlot(ctx, { maxWaitMs: STT_TOKEN_MAX_WAIT_MS });

    const sttStartedAt = Date.now();
    try {
      const { text: transcribed, wordTimings, audioDurationMs } =
        await transcribeAudio(blob, args.language, {
          regionVariant: args.regionVariant,
        });

      // Every synthesized clip is round-tripped through Azure to validate it.
      // That makes this one of the largest spend lines in the app and, until
      // now, an entirely invisible one — it is billed to no feature and no user.
      await captureGeneration(ctx, {
        feature: 'tts_validation_stt',
        model: 'azure-fast-transcription',
        provider: 'azure',
        latencyMs: Date.now() - sttStartedAt,
        costUsd:
          audioDurationMs !== undefined
            ? costForAudioMs('azureStt', audioDurationMs)
            : undefined,
        sharedContent: true,
        extra: {
          text_id: args.textId,
          language: args.language,
          audio_duration_ms: audioDurationMs,
          attempt,
        },
      });

      // Cheap strict check first. For Chinese/Korean this compares
      // pinyin/hangul-romanized strings so the STT model's homophone-character
      // substitutions pass at edit distance 0. If strict still fails, ask
      // Gemini — which also tolerates phonetic names, digits-vs-words,
      // abbreviations, diacritic drift, and single-char noise. Only
      // regenerate if both say no. Gemini errors fall back to the strict
      // verdict (already "no match" at this point), so a flaky LLM can't
      // let bad audio through.
      let isMatch = textsMatchForLanguage(args.text, transcribed, args.language);
      if (!isMatch) {
        // Only reached on a near-miss, so its volume is itself a signal: a
        // spike here means TTS quality regressed for some language.
        const judgeTelemetry: SemanticValidationTelemetry[] = [];
        const semantic = await textsMatchSemantic(
          args.text,
          transcribed,
          args.language,
          (telemetry) => judgeTelemetry.push(telemetry),
        );
        for (const telemetry of judgeTelemetry) {
          await captureGeneration(ctx, {
            feature: 'tts_validation_judge',
            model: OPENROUTER_MODELS.ttsValidation,
            provider: 'openrouter',
            latencyMs: telemetry.latencyMs,
            inputTokens: telemetry.inputTokens,
            outputTokens: telemetry.outputTokens,
            costUsd: telemetry.costUsd,
            traceId: telemetry.generationId,
            sharedContent: true,
            extra: {
              text_id: args.textId,
              language: args.language,
              verdict: semantic,
            },
          });
        }
        if (semantic === 'match') isMatch = true;
      }

      if (isMatch) {
        return { validated: true, lastStorageId, wordTimings };
      }
      console.warn(
        `TTS validation mismatch (attempt ${attempt + 1}/${maxAttempts})`,
        { expected: args.text, got: transcribed },
      );
      await ctx.runMutation(internal.features.ttsProcessing.storeTtsMismatch, {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId,
        expectedText: args.text,
        transcribedText: transcribed,
        attempt: attempt + 1,
      });
    } catch (transcriptionErr) {
      console.error(
        `Transcription failed (attempt ${attempt + 1}/${maxAttempts}):`,
        transcriptionErr,
      );
      if (attempt + 1 < maxAttempts) {
        // The retry will supersede this attempt's blob, and — unlike a
        // mismatch, whose blob the ttsMismatches record keeps for review —
        // an errored transcription references it nowhere, so it would leak.
        // Delayed + reference-checked: if the retry fails to store and the
        // asset ends up keeping this blob, the job sees the reference and
        // spares it.
        await ctx.scheduler.runAfter(
          BLOB_SWAP_DELETE_DELAY_MS,
          internal.features.ttsProcessing.deleteBlobIfUnreferencedJob,
          { storageId },
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 500 + Math.random() * 250),
        );
      }
    }
  }
  return { validated: false, lastStorageId, wordTimings: null };
}

/**
 * Shape of the job payload passed from an enqueue into the worker action.
 */
const ttsJobArgsValidator = v.object({
  textId: v.id('texts'),
  text: v.string(),
  language: v.string(),
  voiceName: v.string(),
  voiceGender: voiceGenderValidator,
  speed: v.number(),
  // Forwarded to `processTTSForCard` for mixed-dialect rows so the validation
  // STT call uses the same locale the voice was synthesized in. Plumbed
  // through enqueueTtsJob from `storeTranslationAndScheduleTTS`.
  regionVariant: v.optional(v.string()),
  // Forced regeneration (regenerateCardAudio): the worker skips the attempt-0
  // early write so the shared audio asset keeps its current audio until the
  // final write swaps it in place.
  forceRegen: v.optional(v.boolean()),
});

type TtsJobArgs = Infer<typeof ttsJobArgsValidator>;

// Explicit handler param types throughout this file: handlers reference
// same-file functions via `internal.…` (enqueue → worker → onComplete), and
// letting TS infer their types through the generated `internal` object is
// circular — inference collapses to `any` for every handler in the module.
type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };

/**
 * Worker action: synthesize + validate + persist audio for one
 * (textId, language).
 *
 * Failure contract: THROW on any failure (synthesis HTTP error — 429s
 * included —, storage error, saturated rate-limit bucket). The pool retries
 * with jittered exponential backoff; the final failure lands in
 * `onTtsJobComplete`, which logs and releases the claim so the next
 * self-heal sweep can re-drive the row.
 */
export const processTTSForCard = internalAction({
  args: {
    ...ttsJobArgsValidator.fields,
    provider: ttsProviderValidator,
  },
  returns: v.null(),
  handler: async (
    ctx: ActionCtx,
    args: TtsJobArgs & { provider: TtsProvider },
  ) => {
    const { validated, lastStorageId, wordTimings } =
      await synthesizeAndValidate(ctx, args, MAX_TTS_VALIDATION_ATTEMPTS);

    if (!validated) {
      console.error(
        `[ttsProcess] Validation failed after ${MAX_TTS_VALIDATION_ATTEMPTS} attempts — marking as unvalidated`,
        { textId: args.textId, language: args.language, text: args.text },
      );
    }

    // Use storeAudioRecording (upsert) so that if the row was deleted mid-flight
    // by the stale-storage cleanup, it gets recreated rather than silently lost.
    // lastStorageId is the blob already in the row, so no old blob is deleted.
    if (lastStorageId !== null) {
      await ctx.runMutation(internal.features.decks.storeAudioRecording, {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId: lastStorageId,
        ttsQuality: validated ? ('validated' as const) : ('unvalidated' as const),
        ttsProvider: args.provider,
        voiceGender: args.voiceGender,
        speed: args.speed,
        // Only persist timings alongside validated audio — mismatched
        // transcriptions point to the wrong words.
        wordTimings: validated && wordTimings ? wordTimings : undefined,
        spokenText: args.text,
        regionVariant: args.regionVariant,
      });
    } else {
      console.error('[ttsProcess] No storageId produced, audio will be missing', {
        textId: args.textId,
        language: args.language,
      });
    }

    return null;
  },
});

/**
 * Enqueue a TTS job into the pool and stamp the pool's workId onto the
 * (textId, language) claim — enqueue and claim update commit atomically, so
 * the claim is released exactly when THIS job's onComplete runs and a
 * superseded job's completion can't delete a newer owner's claim.
 *
 * No-ops when a live pool job already owns the claim (fresh + foreign
 * workId) — see the guard below.
 *
 * The caller is expected to hold the claim already (via `claimTtsIfAvailable`,
 * usually in the same transaction).
 */
export const enqueueTtsJob = internalMutation({
  args: {
    provider: ttsProviderValidator,
    args: ttsJobArgsValidator,
  },
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    { provider, args }: { provider: TtsProvider; args: TtsJobArgs },
  ) => {
    const claim = await getTtsClaim(ctx, args.textId, args.language);
    // A fresh claim already stamped with another job's workId means a live
    // pool job owns this (textId, language): enqueueing again would synthesize
    // twice and hijack that job's claim. Unreachable from the claim-then-
    // enqueue callers (their fresh claim is workId-less); kept as a guard
    // against callers that enqueue without re-claiming.
    if (
      claim &&
      claim.workId !== undefined &&
      Date.now() - claim.claimedAt < TTS_CLAIM_STALE_MS
    ) {
      return null;
    }

    const workId: string = await ttsPool.enqueueAction(
      ctx,
      internal.features.ttsProcessing.processTTSForCard,
      {
        textId: args.textId,
        text: args.text,
        language: args.language,
        voiceName: args.voiceName,
        voiceGender: args.voiceGender,
        speed: args.speed,
        regionVariant: args.regionVariant,
        forceRegen: args.forceRegen,
        provider,
      },
      {
        onComplete: internal.features.ttsProcessing.onTtsJobComplete,
        context: { textId: args.textId, language: args.language },
      },
    );

    if (claim) {
      await ctx.db.patch(claim._id, { workId, claimedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Pool onComplete for `processTTSForCard`. Guaranteed to run on success,
 * failure, and cancellation. Releases the claim (ownership-gated on `workId`,
 * so a superseded job's completion can't delete a newer owner's claim) —
 * releasing on failure too is deliberate: the next self-heal sweep sees
 * "no claim, no audio" and re-drives the row.
 */
export const onTtsJobComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({ textId: v.id('texts'), language: v.string() }),
  ),
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    {
      workId,
      context,
      result,
    }: {
      workId: string;
      context: { textId: Id<'texts'>; language: string };
      result: PoolRunResult;
    },
  ) => {
    if (result.kind === 'failed') {
      console.error(
        '[ttsProcess] Giving up — pool retries exhausted, no audio row will be written',
        {
          textId: context.textId,
          language: context.language,
          error: result.error,
        },
      );
    }
    const claim = await getTtsClaim(ctx, context.textId, context.language);
    if (claim && (claim.workId === undefined || claim.workId === workId)) {
      await ctx.db.delete(claim._id);
    }
    return null;
  },
});

/**
 * Update TTS quality and optionally swap the storage blob for the audio
 * behind a (textId, language) — the mid-retry write of the validate loop.
 * No-ops if the row does not exist.
 *
 * The patch targets the shared `audioAssets` row, and ONLY while that asset
 * is still mid-flight (`ttsQuality === 'unknown'`, i.e. this job created it
 * at attempt 0 and owns it). An asset already carrying completed audio is
 * shared by other texts and is never churned by retries — the job's final
 * write (`storeAudioRecording`) is what replaces it.
 */
export const updateAudioRecordingQuality = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    ttsQuality: ttsQualityValidator,
    storageId: v.optional(v.id('_storage')),
    preserveOldStorage: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (!record) return null;

    const asset = await ctx.db.get(record.assetId);
    if (!asset || asset.ttsQuality !== 'unknown') return null;
    if (args.storageId && args.storageId !== asset.storageId) {
      const previousStorageId = asset.storageId;
      await ctx.db.patch(asset._id, {
        ttsQuality: args.ttsQuality,
        storageId: args.storageId,
      });
      if (!args.preserveOldStorage) {
        await deleteStorageBlobIfUnreferenced(ctx, previousStorageId);
      }
    } else {
      await ctx.db.patch(asset._id, { ttsQuality: args.ttsQuality });
    }
    return null;
  },
});

/**
 * Delayed reference-checked blob delete, scheduled whenever a blob is
 * superseded (asset in-place swap, orphaned-asset cleanup). The delay gives
 * clients holding a just-issued signed URL a grace window; the job re-checks
 * `audioAssets.by_storageId` at fire time, so a blob that is still (or
 * again) referenced simply survives.
 */
export const deleteBlobIfUnreferencedJob = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteStorageBlobIfUnreferenced(ctx, args.storageId);
    return null;
  },
});

/**
 * Persist a mismatched TTS audio blob alongside the expected and
 * transcribed text so it can be reviewed later.
 */
export const storeTtsMismatch = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    voiceName: v.string(),
    storageId: v.id('_storage'),
    expectedText: v.string(),
    transcribedText: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('ttsMismatches', {
      textId: args.textId,
      language: args.language,
      voiceName: args.voiceName,
      storageId: args.storageId,
      expectedText: args.expectedText,
      transcribedText: args.transcribedText,
      attempt: args.attempt,
    });
    return null;
  },
});

/**
 * Backfill word-level timestamps for an existing audio recording that was
 * generated before timings were captured (no `wordTimings` field). Called
 * from `scheduleMissingContent` after acquiring a TTS claim on (textId, lang).
 *
 * Re-downloads the stored audio blob, runs it through STT, and persists the
 * resulting timings — but only if the storageId still matches, so a
 * concurrent voice swap doesn't get clobbered with stale alignment.
 */
export const backfillWordTimings = internalAction({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    storageId: v.id('_storage'),
    // Same purpose as on `processTTSForCard` — the row's persisted Azure STT
    // locale for mixed-dialect languages. Supplied by `scheduleMissingContent`
    // from the translation row when the language is mixed.
    regionVariant: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Azure Fast Transcription is the gate on word timings; if it can't
      // process this locale, the scheduler shouldn't have been called, but
      // guard the action too so a stale scheduler call from before the
      // language was filtered doesn't 400 against Azure.
      if (!languageSupportsStt(args.language)) return null;

      const blob = await ctx.storage.get(args.storageId);
      if (!blob) {
        console.warn('[backfillWordTimings] audio blob missing', {
          textId: args.textId,
          language: args.language,
        });
        return null;
      }
      await reserveAzureSttSlot(ctx, { maxWaitMs: STT_TOKEN_MAX_WAIT_MS });
      const { wordTimings } = await transcribeAudio(blob, args.language, {
        regionVariant: args.regionVariant,
      });
      if (wordTimings.length === 0) return null;
      await ctx.runMutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        {
          textId: args.textId,
          language: args.language,
          storageId: args.storageId,
          wordTimings,
        },
      );
    } catch (err) {
      console.error('[backfillWordTimings] failed', {
        textId: args.textId,
        language: args.language,
        error: err,
      });
    } finally {
      await ctx.runMutation(
        internal.features.ttsProcessing.releaseTtsClaim,
        { textId: args.textId, language: args.language },
      );
    }
    return null;
  },
});

/**
 * Persist word timings produced by `backfillWordTimings`. Guards against
 * storage swaps: if the asset's current `storageId` differs from the one we
 * transcribed, the timings belong to a now-stale blob and are discarded.
 * The patch lands on the shared asset — identical audio means the timings
 * are correct for every text pointing at it.
 */
export const persistBackfilledWordTimings = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    storageId: v.id('_storage'),
    wordTimings: v.array(
      v.object({
        word: v.string(),
        start: v.number(),
        end: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (!record) return null;
    const asset = await ctx.db.get(record.assetId);
    if (!asset || asset.storageId !== args.storageId) return null;
    await ctx.db.patch(asset._id, { wordTimings: args.wordTimings });
    return null;
  },
});

/**
 * Release a TTS generation claim. Called from the `backfillWordTimings`
 * action's finally block (timing backfills hold a claim but aren't pool jobs,
 * so they have no onComplete). Backfill claims are workId-less; a claim
 * carrying a workId belongs to a pool job (a stale backfill's claim was
 * reclaimed and stamped mid-flight) and is released by that job's onComplete
 * — deleting it here would let a scheduler double-enqueue the synthesis.
 */
export const releaseTtsClaim = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await getTtsClaim(ctx, args.textId, args.language);
    if (claim && claim.workId === undefined) {
      await ctx.db.delete(claim._id);
    }
    return null;
  },
});
