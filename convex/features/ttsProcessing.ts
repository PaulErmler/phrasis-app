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
import { ttsQualityValidator } from '../types';

const MAX_TTS_VALIDATION_ATTEMPTS = 3;
const TTS_CLAIM_STALE_MS = 30 * 1000; // 30 seconds

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
  args: { textId: Id<'texts'>; text: string; language: string; voiceName: string },
  maxAttempts: number,
): Promise<{ validated: boolean; lastStorageId: Id<'_storage'> | null }> {
  let lastStorageId: Id<'_storage'> | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const blob = await synthesizeSpeech(args.text, args.voiceName, 0.9);
    const storageId: Id<'_storage'> = await ctx.storage.store(blob);
    lastStorageId = storageId;

    if (attempt === 0) {
      await ctx.runMutation(internal.features.decks.storeAudioRecording, {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId,
        ttsQuality: 'unknown' as const,
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
          `TTS validation failed after ${MAX_TTS_VALIDATION_ATTEMPTS} attempts — marking as unvalidated`,
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
        });
      }
    } catch (err) {
      console.error('TTS processing error:', err);
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
