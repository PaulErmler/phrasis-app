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
import {
  BLOB_SWAP_DELETE_DELAY_MS,
  scheduleBlobSwapDelete,
} from '../lib/audioAssets';
import { TTS_RATE_LIMIT_BY_PROVIDER } from '../rateLimiter';
import { reserveRateLimitToken } from '../lib/rateLimitReserve';
import { ttsPool, ttsWarmPool } from '../lib/workpools';
import type { WorkId } from '@convex-dev/workpool';
import {
  ttsQualityValidator,
  ttsProviderValidator,
  ttsPriorityValidator,
  voiceGenderValidator,
} from '../types';
import type { TtsPriority, TtsProvider, VoiceGender } from '../types';

/**
 * TTS pipeline, built on the `ttsPool` workpool (convex/lib/workpools.ts).
 * Per audio row:
 *
 *   1. `claimTtsIfAvailable` (called by scheduling mutations) atomically
 *      reserves the (textId, language) slot.
 *   2. `enqueueTtsJob` enqueues `processTTSForCard` into the pool and stamps
 *      the pool's workId onto the claim: the claim now lives exactly as long
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
 * backstop, e.g. the onComplete handler itself failing. Generous on purpose:
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
 * Synthesis-token wait cap for priority-'background' jobs. Near-zero on
 * purpose: a warm job may only take a token that is free right now. Any
 * projected wait means interactive demand exists, so the warm worker throws,
 * frees its `ttsWarmPool` slot, and that pool's patient backoff retries
 * later. This is the token half of TTS priority; the queue half is the pool
 * split (see workpools.ts).
 */
const TTS_WARM_TOKEN_MAX_WAIT_MS = 1_000;

/**
 * Longest azureStt refill wait a caller rides out before an STT call
 * (validation roundtrip, word-timing backfill). Deliberately looser than the
 * synthesis cap: a mid-validation throw wastes the synthesis that just
 * happened, and in-pool demand alone can only project ~7s (24 workers on a
 * 200/min bucket), so 15s never fires on ordinary pool contention and only
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
 * One exception to "fresh claim wins": an interactive caller takes over a
 * fresh claim held at priority 'background'. The warm job may be riding
 * `ttsWarmPool`'s patient backoff for many minutes while a user stares at
 * the card's audio spinner, and without takeover the interactive request
 * would no-op until the claim goes stale. The takeover cancels the warm
 * job (a queued/backing-off job dies; one already mid-run finishes, but the
 * caller's enqueue re-stamps `workId` in this same transaction, so the
 * superseded job's ownership-gated completion can't release the new claim —
 * worst case is one duplicate synthesis into the upserting store).
 * Background callers never take over anything.
 *
 * Must be called inside a mutation context so Convex OCC prevents duplicates.
 */
export async function claimTtsIfAvailable(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
  priority?: TtsPriority,
): Promise<Id<'ttsGenerationClaims'> | null> {
  const existing = await getTtsClaim(ctx, textId, language);

  if (existing) {
    if (ttsClaimBlocksPriority(existing, priority)) {
      return null;
    }
    // Not blocking = stale, or a fresh background claim this caller takes
    // over. Only the takeover has a live warm job to cancel.
    const takeover = Date.now() - existing.claimedAt < TTS_CLAIM_STALE_MS;
    if (takeover && existing.workId !== undefined) {
      await ttsWarmPool.cancel(ctx, existing.workId as WorkId);
    }
    await ctx.db.delete(existing._id);
  }

  return await ctx.db.insert('ttsGenerationClaims', {
    textId,
    language,
    claimedAt: Date.now(),
    priority,
  });
}

/**
 * Would `claimTtsIfAvailable` at `priority` return null against this claim?
 * The read-only mirror of that function's fresh-vs-takeover rule, split out
 * so the two can't drift. A fresh claim blocks, EXCEPT a background claim
 * checked at interactive priority (the takeover case, which would write).
 */
function ttsClaimBlocksPriority(
  claim: Doc<'ttsGenerationClaims'>,
  priority: TtsPriority | undefined,
): boolean {
  const fresh = Date.now() - claim.claimedAt < TTS_CLAIM_STALE_MS;
  const takeover =
    fresh && claim.priority === 'background' && priority !== 'background';
  return fresh && !takeover;
}

/**
 * True when a claim exists that `claimTtsIfAvailable` at `priority` would
 * respect (return null against). The probe paths in decks.ts use this
 * instead of `hasActiveTtsClaim`: a background-held slot probed at
 * interactive priority must classify as NEEDY, because the real run would
 * take the claim over (cancel the warm job, re-enqueue interactively) — a
 * write. `hasActiveTtsClaim` is priority-blind and would report it handled,
 * leaving the user waiting out `ttsWarmPool`'s patient backoff.
 */
export async function hasBlockingTtsClaim(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
  priority: TtsPriority | undefined,
): Promise<boolean> {
  const existing = await getTtsClaim(ctx, textId, language);
  return existing !== null && ttsClaimBlocksPriority(existing, priority);
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
 * EVERY synthesis reserves a provider token first, including validation
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
     * write swaps it. Mid-flight 'unknown' churn on shared audio would
     * degrade every other text pointing at the asset.
     */
    forceRegen?: boolean;
    /** Scheduling priority; picks the synthesis-token wait cap below. */
    priority?: TtsPriority;
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
  // straight to unvalidated. wordTimings are unavailable here too.
  const canValidate = languageSupportsStt(args.language);

  const rateLimitName =
    TTS_RATE_LIMIT_BY_PROVIDER[args.provider] ?? 'googleTts';

  // Background (warm) jobs only take tokens that are free immediately;
  // interactive jobs ride out short refills. See the two constants above.
  const tokenMaxWaitMs =
    args.priority === 'background'
      ? TTS_WARM_TOKEN_MAX_WAIT_MS
      : TTS_TOKEN_MAX_WAIT_MS;

  let lastStorageId: Id<'_storage'> | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await reserveRateLimitToken(ctx, rateLimitName, {
      maxWaitMs: tokenMaxWaitMs,
    });
    const synthStartedAt = Date.now();
    const blob = await synthesizeSpeech(
      args.text,
      args.voiceName,
      args.speed,
      args.provider,
      args.language,
    );
    const synthLatencyMs = Date.now() - synthStartedAt;
    // Google bills per character of input text, so the cost is exactly
    // derivable. Gemini TTS goes through OpenRouter, whose per-request cost is
    // only retrievable by a follow-up lookup on the generation id. Recorded
    // without a cost figure so the call volume is at least visible, and
    // flagged so a zero can't be mistaken for "free".
    const synthCostUsd =
      args.provider === 'google'
        ? costForCharacters('googleTts', args.text.length)
        : undefined;
    // ONE event per synthesized clip, covering both the synthesis and its
    // Azure STT validation round-trip (they fire 1:1, and as separate events
    // they doubled TTS event volume in PostHog). Every exit path of this
    // attempt emits exactly once, with `stt_status` recording whether the
    // validation leg ran; `cost_usd` is the sum of both legs.
    const emitTtsEvent = (stt: {
      status: 'ok' | 'error' | 'skipped' | 'backpressure';
      latencyMs?: number;
      audioDurationMs?: number;
      error?: string;
    }) => {
      const sttCostUsd =
        stt.audioDurationMs !== undefined
          ? costForAudioMs('azureStt', stt.audioDurationMs)
          : undefined;
      return captureGeneration(ctx, {
        feature: 'tts_synthesis',
        model: args.voiceName,
        provider: args.provider,
        latencyMs: synthLatencyMs,
        costUsd:
          synthCostUsd !== undefined || sttCostUsd !== undefined
            ? (synthCostUsd ?? 0) + (sttCostUsd ?? 0)
            : undefined,
        sharedContent: true,
        extra: {
          text_id: args.textId,
          language: args.language,
          character_count: args.text.length,
          attempt,
          synth_cost_usd: synthCostUsd,
          synth_cost_source:
            args.provider === 'google' ? 'rate_table' : 'unavailable',
          stt_status: stt.status,
          stt_cost_usd: sttCostUsd,
          stt_latency_ms: stt.latencyMs,
          audio_duration_ms: stt.audioDurationMs,
          stt_error: stt.error,
        },
      });
    };
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
      await emitTtsEvent({ status: 'skipped' });
      return { validated: false, lastStorageId, wordTimings: null };
    }

    // Backpressure, not an STT failure. Kept OUTSIDE the try/catch below so
    // a saturated azureStt bucket throws out of the worker (the pool's
    // backoff retries the whole job once the bucket drains) instead of being
    // swallowed as a transcription error and accepting unvalidated audio
    // over a transient queue spike. The synthesis money was still spent, so
    // its event fires before the throw; the retried job emits its own.
    try {
      await reserveAzureSttSlot(ctx, { maxWaitMs: STT_TOKEN_MAX_WAIT_MS });
    } catch (backpressureErr) {
      await emitTtsEvent({ status: 'backpressure' });
      throw backpressureErr;
    }

    const sttStartedAt = Date.now();
    try {
      const {
        text: transcribed,
        wordTimings,
        audioDurationMs,
      } = await transcribeAudio(blob, args.language, {
        regionVariant: args.regionVariant,
      });

      // Every synthesized clip is round-tripped through Azure to validate it.
      // That makes it one of the largest spend lines in the app, folded into
      // the clip's event here (rate-table cost from the audio duration).
      await emitTtsEvent({
        status: 'ok',
        latencyMs: Date.now() - sttStartedAt,
        audioDurationMs,
      });

      // Cheap strict check first. For Chinese/Korean this compares
      // pinyin/hangul-romanized strings so the STT model's homophone-character
      // substitutions pass at edit distance 0. If strict still fails, ask
      // Gemini, which also tolerates phonetic names, digits-vs-words,
      // abbreviations, diacritic drift, and single-char noise. Only
      // regenerate if both say no. Gemini errors fall back to the strict
      // verdict (already "no match" at this point), so a flaky LLM can't
      // let bad audio through.
      let isMatch = textsMatchForLanguage(
        args.text,
        transcribed,
        args.language,
      );
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
      await emitTtsEvent({
        status: 'error',
        latencyMs: Date.now() - sttStartedAt,
        error:
          transcriptionErr instanceof Error
            ? transcriptionErr.message
            : String(transcriptionErr),
      });
      if (attempt + 1 < maxAttempts) {
        // The retry will supersede this attempt's blob, and. Unlike a
        // mismatch, whose blob the ttsMismatches record keeps for review.
        // An errored transcription references it nowhere, so it would leak.
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
  // Scheduling priority (see ttsPriorityValidator). Picks the pool at
  // enqueue time and the rate-limit wait cap in the worker. Absent =
  // 'interactive'.
  priority: v.optional(ttsPriorityValidator),
});

type TtsJobArgs = Infer<typeof ttsJobArgsValidator>;

// Explicit handler param types throughout this file: handlers reference
// same-file functions via `internal.…` (enqueue → worker → onComplete), and
// letting TS infer their types through the generated `internal` object is
// circular. Inference collapses to `any` for every handler in the module.
type PoolRunResult =
  | { kind: 'success'; returnValue: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' };

/**
 * Worker action: synthesize + validate + persist audio for one
 * (textId, language).
 *
 * Failure contract: THROW on any failure (synthesis HTTP error, 429s
 * included, storage error, saturated rate-limit bucket). The pool retries
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
        ttsQuality: validated
          ? ('validated' as const)
          : ('unvalidated' as const),
        ttsProvider: args.provider,
        voiceGender: args.voiceGender,
        speed: args.speed,
        // Only persist timings alongside validated audio. Mismatched
        // transcriptions point to the wrong words.
        wordTimings: validated && wordTimings ? wordTimings : undefined,
        spokenText: args.text,
        regionVariant: args.regionVariant,
      });
    } else {
      console.error(
        '[ttsProcess] No storageId produced, audio will be missing',
        {
          textId: args.textId,
          language: args.language,
        },
      );
    }

    return null;
  },
});

/**
 * Enqueue a TTS job into the pool and stamp the pool's workId onto the
 * (textId, language) claim. Enqueue and claim update commit atomically, so
 * the claim is released exactly when THIS job's onComplete runs and a
 * superseded job's completion can't delete a newer owner's claim.
 *
 * No-ops when a live pool job already owns the claim (fresh + foreign
 * workId), see the guard below.
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

    // Priority = pool choice: interactive jobs go to ttsPool, warm jobs to
    // the low-parallelism ttsWarmPool (see workpools.ts). Both pools share
    // onTtsJobComplete, so claim lifetime is identical either way.
    const pool = args.priority === 'background' ? ttsWarmPool : ttsPool;
    const workId: string = await pool.enqueueAction(
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
        priority: args.priority,
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
 * so a superseded job's completion can't delete a newer owner's claim),
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
 * behind a (textId, language), the mid-retry write of the validate loop.
 * No-ops if the row does not exist.
 *
 * The patch targets the shared `audioAssets` row, and ONLY while that asset
 * is still mid-flight (`ttsQuality === 'unknown'`, i.e. this job created it
 * at attempt 0 and owns it). An asset already carrying completed audio is
 * shared by other texts and is never churned by retries. The job's final
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
      // Same dead-asset guard as storeAudioRecording: never re-point the
      // asset at a blob that no longer exists.
      if ((await ctx.db.system.get(args.storageId)) === null) {
        return null;
      }
      const previousStorageId = asset.storageId;
      await ctx.db.patch(asset._id, {
        ttsQuality: args.ttsQuality,
        storageId: args.storageId,
      });
      if (!args.preserveOldStorage) {
        // Delayed, not immediate: a concurrent job for the same key may
        // still hold `previousStorageId` as its lastStorageId and reference
        // it in its final write. The delayed job re-checks references at
        // fire time, so it only collects what nothing ended up keeping.
        await scheduleBlobSwapDelete(ctx, previousStorageId);
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
 * resulting timings, but only if the storageId still matches, so a
 * concurrent voice swap doesn't get clobbered with stale alignment.
 */
export const backfillWordTimings = internalAction({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    storageId: v.id('_storage'),
    // Same purpose as on `processTTSForCard`. The row's persisted Azure STT
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
      await ctx.runMutation(internal.features.ttsProcessing.releaseTtsClaim, {
        textId: args.textId,
        language: args.language,
      });
    }
    return null;
  },
});

/**
 * Persist word timings produced by `backfillWordTimings`. Guards against
 * storage swaps: if the asset's current `storageId` differs from the one we
 * transcribed, the timings belong to a now-stale blob and are discarded.
 * The patch lands on the shared asset. Identical audio means the timings
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
 * Deleting it here would let a scheduler double-enqueue the synthesis.
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
