import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  ActionCtx,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import {
  synthesizeSpeech,
  transcribeAudio,
  reserveAzureSttSlot,
  type WordTiming,
} from './tts';
import { languageSupportsStt } from '../../lib/languages';
import { textsMatchForLanguage } from '../lib/textComparison';
import { textsMatchSemantic } from '../lib/ttsSemanticValidation';
import { rateLimiter, TTS_RATE_LIMIT_BY_PROVIDER } from '../rateLimiter';
import {
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
} from '../types';
import type { TtsProvider, VoiceGender } from '../types';

const MAX_TTS_VALIDATION_ATTEMPTS = 2;
const TTS_CLAIM_STALE_MS = 30 * 1000; // 30 seconds

/**
 * Per-provider concurrency caps. With the LLM queue capped at 64, translations
 * complete in waves and TTS would otherwise burst against provider quotas.
 * `pumpQueue` consults these caps and the `countLiveSlotsAndReclaimStale`
 * helper below to gate dispatch.
 */
const PROVIDER_MAX_CONCURRENCY: Partial<Record<TtsProvider, number>> = {
  google: 64,
  azure: 8,
  // Conservative start for OpenRouter-hosted Gemini TTS; tune after first runs.
  gemini: 8,
};
// Fallback cap for any provider missing from the map above (e.g. the
// 'elevenlabs' tombstone, which is never dispatched).
const DEFAULT_MAX_CONCURRENCY = 8;
const SLOT_STALE_MS = 60 * 1000; // 1 minute — longer than the longest API call

/**
 * Atomically check-and-insert a TTS generation claim.
 * Returns true if the claim was acquired (caller should schedule the action).
 * Returns false if a fresh claim already exists (another mutation already
 * scheduled this work). Claims older than `TTS_CLAIM_STALE_MS` are removed
 * and treated as expired so work can be retried.
 *
 * Must be called inside a mutation context so Convex OCC prevents duplicates.
 */
export async function claimTtsIfAvailable(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query('ttsGenerationClaims')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .first();

  if (existing) {
    if (Date.now() - existing.claimedAt < TTS_CLAIM_STALE_MS) {
      return false;
    }
    await ctx.db.delete(existing._id);
  }

  await ctx.db.insert('ttsGenerationClaims', {
    textId,
    language,
    claimedAt: Date.now(),
  });
  return true;
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
  const existing = await ctx.db
    .query('ttsGenerationClaims')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .first();
  if (!existing) return false;
  return Date.now() - existing.claimedAt < TTS_CLAIM_STALE_MS;
}

/**
 * Synthesize speech, transcribe it back, and compare to the original.
 * Retries up to `maxAttempts` times, storing each attempt's audio and
 * logging mismatches. Returns whether the final audio was validated and the
 * last stored blob id (for upserting the DB row if it was removed mid-flight).
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

  let lastStorageId: Id<'_storage'> | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const blob = await synthesizeSpeech(
      args.text,
      args.voiceName,
      args.speed,
      args.provider,
      args.language,
    );
    const storageId: Id<'_storage'> = await ctx.storage.store(blob);
    lastStorageId = storageId;

    if (attempt === 0) {
      await ctx.runMutation(internal.features.decks.storeAudioRecording, {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId,
        ttsQuality: 'unknown' as const,
        ttsProvider: args.provider,
        voiceGender: args.voiceGender,
        speed: args.speed,
      });
    } else {
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

    try {
      await reserveAzureSttSlot(ctx);
      const { text: transcribed, wordTimings } = await transcribeAudio(
        blob,
        args.language,
        { regionVariant: args.regionVariant },
      );

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
        const semantic = await textsMatchSemantic(
          args.text,
          transcribed,
          args.language,
        );
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
        await new Promise((resolve) =>
          setTimeout(resolve, 500 + Math.random() * 250),
        );
      }
    }
  }
  return { validated: false, lastStorageId, wordTimings: null };
}

/**
 * Internal action to process TTS for a card with validation.
 *
 * Generates speech, transcribes it back via OpenAI, and compares to
 * the original text.  Retries up to MAX_TTS_VALIDATION_ATTEMPTS times
 * before falling back to "unvalidated".
 */
export const processTTSForCard = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
    voiceName: v.string(),
    provider: ttsProviderValidator,
    voiceGender: voiceGenderValidator,
    speed: v.number(),
    // Slot ID pre-assigned by pumpQueue. The action always holds a slot for
    // the full duration of its API work; it never self-schedules or polls.
    slotId: v.id('ttsProviderSlots'),
    // Azure STT locale persisted on the translation row for mixed-dialect
    // languages (today: es_mixed → `es-ES` or `es-US`). Plumbed end-to-end
    // so the validation roundtrip transcribes against the same locale the
    // voice was synthesized in instead of falling back to the mixed code's
    // default Azure locale.
    regionVariant: v.optional(v.string()),
    // Forwarded from the queue row. Undefined / 0 = first attempt.
    // Incremented on each thrown exception and re-enqueued up to
    // `MAX_TTS_RETRY_ATTEMPTS` so transient synthesis / storage failures
    // self-heal without an external sweep.
    failureCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Tracks whether the catch block re-enqueued this job. When true,
    // `finalize` must NOT drop the TTS claim — the requeue depends on it
    // being held so a concurrent `scheduleMissingContent` can't see "no
    // claim, no audio" and enqueue a duplicate.
    let scheduledRetry = false;
    try {
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
        });
      } else {
        console.error('[ttsProcess] No storageId produced, audio will be missing', {
          textId: args.textId,
          language: args.language,
        });
      }
    } catch (err) {
      const prior = args.failureCount ?? 0;
      console.error('[ttsProcess] TTS processing error:', {
        textId: args.textId,
        language: args.language,
        failureCount: prior,
        error: err,
      });

      if (prior < MAX_TTS_RETRY_ATTEMPTS) {
        try {
          await ctx.runMutation(
            internal.features.ttsProcessing.enqueueTtsJob,
            {
              provider: args.provider,
              args: {
                textId: args.textId,
                text: args.text,
                language: args.language,
                voiceName: args.voiceName,
                voiceGender: args.voiceGender,
                speed: args.speed,
                regionVariant: args.regionVariant,
                failureCount: prior + 1,
              },
              // Retries inherit no caller priority context; default to 0.
              // The original priority is lost on retry — acceptable since
              // a thrown TTS exception is rare and the retry tail latency
              // matters less than not getting an audio row at all.
            },
          );
          scheduledRetry = true;
        } catch (reEnqueueErr) {
          console.error(
            '[ttsProcess] Failed to re-enqueue TTS job after error',
            {
              textId: args.textId,
              language: args.language,
              error: reEnqueueErr,
            },
          );
        }
      } else {
        console.error(
          `[ttsProcess] Giving up after ${MAX_TTS_RETRY_ATTEMPTS} retries — no audio row will be written`,
          { textId: args.textId, language: args.language },
        );
      }
    } finally {
      // Release slot + claim + wake next queued waiter in one transaction
      // so an action retry can't leave slot/claim state drifted from queue
      // depth. When a retry is scheduled, keep the claim alive so the
      // retry's enqueue doesn't race against `scheduleMissingContent`
      // seeing "no claim, no audio" and double-enqueueing.
      await ctx.runMutation(internal.features.ttsProcessing.finalizeTtsJob, {
        slotId: args.slotId,
        provider: args.provider,
        textId: args.textId,
        language: args.language,
        keepClaim: scheduledRetry,
      });
    }

    return null;
  },
});

/**
 * Update TTS quality and optionally swap the storage blob on an
 * existing audioRecording row. No-ops if the row does not exist.
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

    const patch: { ttsQuality: typeof args.ttsQuality; storageId?: Id<'_storage'> } = {
      ttsQuality: args.ttsQuality,
    };

    if (args.storageId && args.storageId !== record.storageId) {
      const previousStorageId = record.storageId;
      patch.storageId = args.storageId;
      await ctx.db.patch(record._id, patch);
      if (!args.preserveOldStorage) {
        await ctx.storage.delete(previousStorageId);
      }
    } else {
      await ctx.db.patch(record._id, patch);
    }

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
      await reserveAzureSttSlot(ctx);
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
 * storage swaps: if the row's current `storageId` differs from the one we
 * transcribed, the timings belong to a now-stale blob and are discarded.
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
    if (record.storageId !== args.storageId) return null;
    await ctx.db.patch(record._id, { wordTimings: args.wordTimings });
    return null;
  },
});

/**
 * Release a TTS generation claim so the slot can be retried if needed.
 * Called from the processTTSForCard action's finally block.
 */
export const releaseTtsClaim = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.db
      .query('ttsGenerationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (claim) {
      await ctx.db.delete(claim._id);
    }
    return null;
  },
});

/**
 * Shape of the job payload passed from an enqueue into the action.
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
  // Number of prior `processTTSForCard` failures for this (textId, language).
  // Incremented and re-enqueued on each thrown exception, up to
  // `MAX_TTS_RETRY_ATTEMPTS`, then dropped. Absent = first attempt.
  failureCount: v.optional(v.number()),
});

// Number of times `processTTSForCard` is allowed to re-enqueue itself after
// a thrown exception before giving up. Validation-mismatch retries are
// separate (governed by `MAX_TTS_VALIDATION_ATTEMPTS` inside a single run);
// this cap covers harder failure modes — synthesis API throws, storage
// timeouts, transcription crashes — that today leave a translation row
// without audio. 2 retries → up to 3 total invocations per job.
const MAX_TTS_RETRY_ATTEMPTS = 2;

/**
 * Count live slots for a provider and reclaim any stale rows (from crashed
 * actions) in-place. Returns the up-to-date live count. Called by `pumpQueue`
 * to enforce `PROVIDER_MAX_CONCURRENCY`.
 */
export async function countLiveSlotsAndReclaimStale(
  ctx: MutationCtx,
  provider: TtsProvider,
): Promise<number> {
  // Bounded: legitimate slot count is capped by provider concurrency (tens).
  // 500 is well above that, so hitting the cap means something upstream is
  // leaking slots — surface it instead of blowing up the mutation.
  const rows = await ctx.db
    .query('ttsProviderSlots')
    .withIndex('by_provider', (q) => q.eq('provider', provider))
    .take(500);
  const now = Date.now();
  let fresh = 0;
  for (const row of rows) {
    if (now - row.claimedAt > SLOT_STALE_MS) {
      await ctx.db.delete(row._id);
    } else {
      fresh++;
    }
  }
  return fresh;
}

/**
 * Dispatch as many queued jobs as the provider's concurrency cap allows.
 * Called from `enqueueTtsJob` (to kick off new work) and after every slot
 * release (to wake the next FIFO waiter). Safe to call when the queue is
 * empty or the provider is at capacity — both are no-ops.
 *
 * Within a single mutation the loop is atomic: slot insertion + scheduler
 * insert + queue row deletion all commit together, so we never dispatch
 * more than `cap` and never lose a queue row to a partial dispatch.
 */
export const pumpQueue = internalMutation({
  args: { provider: ttsProviderValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Priority order drained per pump tick: critical (2, onboarding seed /
    // placement test) first, then high (1, active collection), then normal
    // (0), then any pre-priority rows (undefined) left over from a deploy.
    const QUEUE_PRIORITY_ORDER = [2, 1, 0, undefined] as const;
    const cap = PROVIDER_MAX_CONCURRENCY[args.provider] ?? DEFAULT_MAX_CONCURRENCY;
    let used = await countLiveSlotsAndReclaimStale(ctx, args.provider);

    // Returns the oldest queued row at the highest non-empty priority, or null
    // when the queue is empty. FIFO within each level via the queuedAt suffix.
    const dequeueNext = async () => {
      for (const priority of QUEUE_PRIORITY_ORDER) {
        const row = await ctx.db
          .query('ttsQueue')
          .withIndex('by_provider_priority_and_queuedAt', (q) =>
            q.eq('provider', args.provider).eq('priority', priority),
          )
          .order('asc')
          .first();
        if (row) return row;
      }
      return null;
    };

    while (used < cap) {
      const next = await dequeueNext();
      if (!next) break;

      // Reserve one provider request from the per-minute budget. `reserve:
      // true` lets the limiter schedule us into a future slot when the
      // bucket is empty rather than failing; `retryAfter` is the delay
      // (in ms) before the HTTP call may fire. With our concurrency cap
      // of `cap` jobs per pump and Google's 190/min budget, the worst-case
      // reservation is ~10s — comfortably inside `TTS_CLAIM_STALE_MS`.
      const limit = await rateLimiter.limit(
        ctx,
        TTS_RATE_LIMIT_BY_PROVIDER[args.provider] ?? 'googleTts',
        { reserve: true },
      );
      if (!limit.ok) {
        // Reservation pool is full (only reachable if a future `maxReserved`
        // gets configured). Stop dispatching this tick and wake the pump
        // when capacity is expected to free up.
        await ctx.scheduler.runAfter(
          Math.max(0, limit.retryAfter ?? 0),
          internal.features.ttsProcessing.pumpQueue,
          { provider: args.provider },
        );
        break;
      }
      const dispatchDelayMs = Math.max(0, limit.retryAfter ?? 0);

      const slotId = await ctx.db.insert('ttsProviderSlots', {
        provider: args.provider,
        claimedAt: Date.now(),
      });
      await ctx.db.delete(next._id);
      await ctx.scheduler.runAfter(
        dispatchDelayMs,
        internal.features.ttsProcessing.processTTSForCard,
        {
          ...next.args,
          provider: args.provider,
          slotId,
        },
      );
      used++;
    }

    return null;
  },
});

/**
 * Insert a TTS job into the priority queue and immediately try to dispatch.
 * Higher-priority jobs jump in front of lower ones; same priority is FIFO.
 * `priority` defaults to 0 (normal). Callers scheduling for the requesting
 * user's currently-active collection should pass 1.
 */
export const enqueueTtsJob = internalMutation({
  args: {
    provider: ttsProviderValidator,
    args: ttsJobArgsValidator,
    priority: v.optional(v.union(v.literal(0), v.literal(1), v.literal(2))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('ttsQueue', {
      provider: args.provider,
      args: args.args,
      queuedAt: Date.now(),
      priority: args.priority ?? 0,
    });
    // Pump runs in its own transaction (scheduler.runAfter, not runMutation):
    // with the provider cap re-enabled, the pump reads `ttsProviderSlots`, and
    // many concurrent enqueues all doing read-modify-write on the same table
    // would OCC-retry until they converge. Same reasoning as
    // `enqueueLlmTranslation` — see its docstring for the full rationale.
    await ctx.scheduler.runAfter(
      0,
      internal.features.ttsProcessing.pumpQueue,
      { provider: args.provider },
    );
    return null;
  },
});

/**
 * Release a provider concurrency slot and immediately dispatch the next
 * queued waiter (if any). Combining both into one mutation closes the race
 * window where a concurrent enqueue could observe "at capacity" just after
 * the slot was deleted but before the pump ran.
 */
export const releaseSlotAndPump = internalMutation({
  args: {
    slotId: v.id('ttsProviderSlots'),
    provider: ttsProviderValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.slotId);
    if (row) {
      await ctx.db.delete(args.slotId);
    }
    // Pump in a separate transaction to avoid OCC contention with concurrent
    // releases/enqueues all reading `ttsProviderSlots`.
    await ctx.scheduler.runAfter(
      0,
      internal.features.ttsProcessing.pumpQueue,
      { provider: args.provider },
    );
    return null;
  },
});

/**
 * End-of-job cleanup: drop the provider slot, drop the dedupe claim, and
 * pump the next queued waiter — all in one transaction. Called from the
 * `processTTSForCard` action's `finally` block so an action retry can't
 * commit a partial cleanup that leaves slot/claim state drifted from queue
 * depth. Idempotent: missing slot or claim rows are silently skipped.
 */
export const finalizeTtsJob = internalMutation({
  args: {
    slotId: v.id('ttsProviderSlots'),
    provider: ttsProviderValidator,
    textId: v.id('texts'),
    language: v.string(),
    // Set true when the worker scheduled a retry. Keeps the claim alive so
    // a concurrent `scheduleMissingContent` can't observe "no claim, no
    // audio" and double-enqueue before the retry runs.
    keepClaim: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slot = await ctx.db.get(args.slotId);
    if (slot) {
      await ctx.db.delete(args.slotId);
    }
    if (!args.keepClaim) {
      const claim = await ctx.db
        .query('ttsGenerationClaims')
        .withIndex('by_text_and_language', (q) =>
          q.eq('textId', args.textId).eq('language', args.language),
        )
        .first();
      if (claim) {
        await ctx.db.delete(claim._id);
      }
    }
    // Pump in a separate transaction to avoid OCC contention with concurrent
    // finalizers/enqueues all reading `ttsProviderSlots`.
    await ctx.scheduler.runAfter(
      0,
      internal.features.ttsProcessing.pumpQueue,
      { provider: args.provider },
    );
    return null;
  },
});
