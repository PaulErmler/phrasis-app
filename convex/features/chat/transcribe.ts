import { v, ConvexError } from 'convex/values';
import { action, internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { requireAuthUserId } from '../../db/users';
import { consumeQuota } from '../../usage/helpers';
import { FEATURE_IDS } from '../featureIds';
import { transcribeAudio as runStt } from '../../lib/stt';

export const consumeTranscriptionQuota = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await consumeQuota(ctx, args.userId, FEATURE_IDS.TRANSCRIPTIONS, 1);
    return null;
  },
});

/**
 * Transcribe audio for chat voice input. Wraps the shared STT helper in
 * `../../lib/stt` with auth + quota. Language is auto-detected — chat UI
 * doesn't track source language.
 */
export const transcribeAudio = action({
  args: {
    audio: v.bytes(),
    mimeType: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    await ctx.runMutation(
      internal.features.chat.transcribe.consumeTranscriptionQuota,
      { userId },
    );

    try {
      const baseMime = (args.mimeType ?? 'audio/webm').split(';')[0].trim();
      const blob = new Blob([args.audio], { type: baseMime });
      const { text } = await runStt(blob);
      return text;
    } catch (error) {
      console.error('Transcription error:', error);
      throw new ConvexError(
        error instanceof Error ? error.message : 'Failed to transcribe audio',
      );
    }
  },
});
