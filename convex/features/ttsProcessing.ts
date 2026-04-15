import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  ActionCtx,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { synthesizeSpeech, transcribeAudio } from './tts';
import { textsMatch } from '../lib/textComparison';
import {
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
} from '../types';
import type { TtsProvider, VoiceGender } from '../types';

const MAX_TTS_VALIDATION_ATTEMPTS = 2;
const TTS_CLAIM_STALE_MS = 30 * 1000; // 30 seconds

/**
 * Per-provider concurrency caps. ElevenLabs free/starter plans allow 3
 * parallel requests. Google has very generous quotas so we don't gate it.
 */
const PROVIDER_MAX_CONCURRENCY: Record<TtsProvider, number> = {
  google: 20,
  elevenlabs: 3,
};
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
  },
  maxAttempts: number,
): Promise<{ validated: boolean; lastStorageId: Id<'_storage'> | null }> {
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

    try {
      const transcribed = await transcribeAudio(blob, args.language);
      if (textsMatch(args.text, transcribed)) {
        return { validated: true, lastStorageId };
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
  return { validated: false, lastStorageId };
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const { validated, lastStorageId } = await synthesizeAndValidate(
        ctx,
        args,
        MAX_TTS_VALIDATION_ATTEMPTS,
      );

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
      // Release slot + wake next queued waiter (if any) in a single mutation
      // so there's no race between release and pump. releaseTtsClaim is
      // independent — run it after.
      await ctx.runMutation(
        internal.features.ttsProcessing.releaseSlotAndPump,
        { slotId: args.slotId, provider: args.provider },
      );
      await ctx.runMutation(internal.features.ttsProcessing.releaseTtsClaim, {
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
});

/**
 * Count live slots for a provider and reclaim any stale rows (from crashed
 * actions) in-place. Returns the up-to-date live count.
 */
async function countLiveSlotsAndReclaimStale(
  ctx: MutationCtx,
  provider: TtsProvider,
): Promise<number> {
  const rows = await ctx.db
    .query('ttsProviderSlots')
    .withIndex('by_provider', (q) => q.eq('provider', provider))
    .collect();
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
    const cap = PROVIDER_MAX_CONCURRENCY[args.provider as TtsProvider];
    let used = await countLiveSlotsAndReclaimStale(
      ctx,
      args.provider as TtsProvider,
    );

    while (used < cap) {
      const next = await ctx.db
        .query('ttsQueue')
        .withIndex('by_provider_and_queuedAt', (q) =>
          q.eq('provider', args.provider),
        )
        .order('asc')
        .first();
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
      used++;
    }

    return null;
  },
});

/**
 * Insert a TTS job into the FIFO queue and immediately try to dispatch it.
 * If a slot is free the action will start on the next scheduler tick; if
 * not, the job waits until a slot release fires `pumpQueue` again.
 */
export const enqueueTtsJob = internalMutation({
  args: {
    provider: ttsProviderValidator,
    args: ttsJobArgsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('ttsQueue', {
      provider: args.provider,
      args: args.args,
      queuedAt: Date.now(),
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
