import { v, ConvexError } from 'convex/values';
import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { requireAuthUserId } from '../../db/users';
import { consumeQuota } from '../../usage/helpers';
import { FEATURE_IDS } from '../featureIds';
import { transcribeAudio as runStt } from '../../lib/stt';
import { getActiveCourseForUser } from '../../db/courses';

export const consumeTranscriptionQuota = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await consumeQuota(ctx, args.userId, FEATURE_IDS.TRANSCRIPTIONS, 1);
    return null;
  },
});

/**
 * Read the active course's base + target language codes so chat-voice
 * transcription can run Azure language-ID across the 8 most-common locales
 * PLUS the codes the user is actively studying. Returns an empty array when
 * the user has no active course — the helper still falls back to the base set.
 */
export const getActiveCourseLanguages = internalQuery({
  args: { userId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { userId }) => {
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];
    const { course } = active;
    return [...new Set([...course.baseLanguages, ...course.targetLanguages])];
  },
});

/**
 * Transcribe audio for chat voice input. Wraps the shared STT helper in
 * `../../lib/stt` with auth + quota. Language is auto-detected, but the
 * candidate-locale list is built from the 8 most-common languages plus the
 * active course's languages so dialect codes (Iraqi Arabic, Cantonese, etc.)
 * participate in language-ID even when not in the global top-N.
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

    const courseLanguages = await ctx.runQuery(
      internal.features.chat.transcribe.getActiveCourseLanguages,
      { userId },
    );

    try {
      const baseMime = (args.mimeType ?? 'audio/webm').split(';')[0].trim();
      const blob = new Blob([args.audio], { type: baseMime });
      const { text } = await runStt(blob, undefined, {
        autoDetectCourseLanguages: courseLanguages,
      });
      return text;
    } catch (error) {
      console.error('Transcription error:', error);
      throw new ConvexError(
        error instanceof Error ? error.message : 'Failed to transcribe audio',
      );
    }
  },
});
