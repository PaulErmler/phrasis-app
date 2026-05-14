import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  ActionCtx,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { synthesizeSpeech, transcribeAudio, type WordTiming } from './tts';
import { languageSupportsStt } from '../../lib/languages';
import { textsMatchForLanguage } from '../lib/textComparison';
import { textsMatchSemantic } from '../lib/ttsSemanticValidation';
import {
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
} from '../types';
import type { TtsProvider, VoiceGender } from '../types';

const MAX_TTS_VALIDATION_ATTEMPTS = 2;
const TTS_CLAIM_STALE_MS = 30 * 1000; // 30 seconds

/**
 * Per-provider concurrency caps. Dormant while TTS runs Google-only —
 * `pumpQueue` below dispatches without consulting these limits. Google's
 * own quota is generous enough that the semaphore is pure overhead at the
 * moment. If rate limits start biting (or a second provider is re-enabled),
 * restore the `while (used < cap)` gate in `pumpQueue` and re-enable
 * `countLiveSlotsAndReclaimStale`.
 */
// const PROVIDER_MAX_CONCURRENCY: Record<TtsProvider, number> = {
//   google: 20,
//   elevenlabs: 3,
// };
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
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
      console.error('[ttsProcess] TTS processing error:', {
        textId: args.textId,
        language: args.language,
        error: err,
      });
    } finally {
      // Release slot + claim + wake next queued waiter in one transaction
      // so an action retry can't leave slot/claim state drifted from queue
      // depth.
      await ctx.runMutation(internal.features.ttsProcessing.finalizeTtsJob, {
        slotId: args.slotId,
        provider: args.provider,
        textId: args.textId,
        language: args.language,
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
});

/**
 * Count live slots for a provider and reclaim any stale rows (from crashed
 * actions) in-place. Returns the up-to-date live count.
 *
 * Exported but currently unused — called only by the dormant `while (used < cap)`
 * branch in `pumpQueue`. Kept around so re-enabling concurrency gating is
 * a one-line uncomment.
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
    // Concurrency gating is dormant — see PROVIDER_MAX_CONCURRENCY above. We
    // still emit a slot row per dispatched job so `processTTSForCard` can
    // keep its existing `slotId` contract and `releaseSlotAndPump` has
    // something to delete in its finally block. The slot count is never
    // consulted, so dispatch is bounded only by queue depth.
    // const cap = PROVIDER_MAX_CONCURRENCY[args.provider as TtsProvider];
    // let used = await countLiveSlotsAndReclaimStale(
    //   ctx,
    //   args.provider as TtsProvider,
    // );

    while (true) {
      // Priority drain: high-priority (1, active collection) first, then
      // normal (0), then any pre-priority rows (undefined) left over from a
      // deploy. FIFO within each level via the queuedAt suffix in the index.
      const next =
        (await ctx.db
          .query('ttsQueue')
          .withIndex('by_provider_priority_and_queuedAt', (q) =>
            q.eq('provider', args.provider).eq('priority', 1),
          )
          .order('asc')
          .first()) ??
        (await ctx.db
          .query('ttsQueue')
          .withIndex('by_provider_priority_and_queuedAt', (q) =>
            q.eq('provider', args.provider).eq('priority', 0),
          )
          .order('asc')
          .first()) ??
        (await ctx.db
          .query('ttsQueue')
          .withIndex('by_provider_priority_and_queuedAt', (q) =>
            q.eq('provider', args.provider).eq('priority', undefined),
          )
          .order('asc')
          .first());
      if (!next) break;

      const slotId = await ctx.db.insert('ttsProviderSlots', {
        provider: args.provider,
        claimedAt: Date.now(),
      });
      await ctx.db.delete(next._id);
      await ctx.scheduler.runAfter(
        0,
        internal.features.ttsProcessing.processTTSForCard,
        {
          ...next.args,
          provider: args.provider,
          slotId,
        },
      );
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
    priority: v.optional(v.union(v.literal(0), v.literal(1))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('ttsQueue', {
      provider: args.provider,
      args: args.args,
      queuedAt: Date.now(),
      priority: args.priority ?? 0,
    });
    await ctx.runMutation(internal.features.ttsProcessing.pumpQueue, {
      provider: args.provider,
    });
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
    await ctx.runMutation(internal.features.ttsProcessing.pumpQueue, {
      provider: args.provider,
    });
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slot = await ctx.db.get(args.slotId);
    if (slot) {
      await ctx.db.delete(args.slotId);
    }
    const claim = await ctx.db
      .query('ttsGenerationClaims')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (claim) {
      await ctx.db.delete(claim._id);
    }
    await ctx.runMutation(internal.features.ttsProcessing.pumpQueue, {
      provider: args.provider,
    });
    return null;
  },
});
