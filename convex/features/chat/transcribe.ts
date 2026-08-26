import { v, ConvexError } from 'convex/values';
import { action, internalMutation, internalQuery } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { requireAuthUserId } from '../../db/users';
import { consumeQuota } from '../../usage/helpers';
import { FEATURE_IDS } from '../featureIds';
import { transcribeAudio as runStt, reserveAzureSttSlot } from '../../lib/stt';
import { getActiveCourseForUser } from '../../db/courses';
import { EVENTS, track } from '../../analytics';
import { captureGeneration } from '../../lib/posthogAi';
import { costForAudioMs } from '../../config/aiCosts';

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
 * the user has no active course. The helper still falls back to the base set.
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
    // Pin transcription to one language (internal code) instead of running
    // language-ID over the course languages. Used by writing-mode voice
    // input, where the row's target language is already known — a single
    // locale gives Azure its best accuracy. `regionVariant` narrows a
    // mixed-dialect code (e.g. es_mixed) to its concrete Azure locale.
    language: v.optional(v.string()),
    regionVariant: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    await ctx.runMutation(
      internal.features.chat.transcribe.consumeTranscriptionQuota,
      { userId },
    );

    const courseLanguages = args.language
      ? []
      : await ctx.runQuery(
          internal.features.chat.transcribe.getActiveCourseLanguages,
          { userId },
        );

    const startedAt = Date.now();
    try {
      const baseMime = (args.mimeType ?? 'audio/webm').split(';')[0].trim();
      const blob = new Blob([args.audio], { type: baseMime });
      await reserveAzureSttSlot(ctx, { maxWaitMs: 3000 });
      const { text, audioDurationMs } = await runStt(blob, args.language, {
        ...(args.language
          ? { regionVariant: args.regionVariant }
          : { autoDetectCourseLanguages: courseLanguages }),
      });

      await captureGeneration(ctx, {
        distinctId: userId,
        feature: 'chat_voice_input',
        model: 'azure-fast-transcription',
        provider: 'azure',
        latencyMs: Date.now() - startedAt,
        costUsd:
          audioDurationMs !== undefined
            ? costForAudioMs('azureStt', audioDurationMs)
            : undefined,
        extra: {
          audio_duration_ms: audioDurationMs,
          transcript_chars: text.length,
        },
      });
      await track(ctx, userId, EVENTS.VOICE_TRANSCRIBED, {
        audio_duration_ms: audioDurationMs,
        transcript_chars: text.length,
      });
      return text;
    } catch (error) {
      // This is an action, so nothing rolls back when it throws. Unlike the
      // mutation paths, the failure event genuinely persists.
      await track(ctx, userId, EVENTS.VOICE_TRANSCRIPTION_FAILED, {
        latency_ms: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      console.error('Transcription error:', error);
      // Structured errors (e.g. RATE_LIMITED from the STT slot reservation)
      // pass through with their code intact.
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({
        code: 'UPSTREAM_ERROR',
        message:
          error instanceof Error ? error.message : 'Failed to transcribe audio',
      });
    }
  },
});
