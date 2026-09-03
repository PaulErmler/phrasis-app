import { v, ConvexError, type Infer } from 'convex/values';
import {
  action,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { internal } from '../../_generated/api';
import { requireAuthUserId } from '../../db/users';
import { consumeQuota } from '../../usage/helpers';
import { FEATURE_IDS } from '../featureIds';
import {
  transcribeAudio as runStt,
  reserveAzureSttSlot,
  AzureMultipleLanguagesError,
} from '../../lib/stt';
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

const courseLanguagesValidator = v.object({
  base: v.array(v.string()),
  target: v.array(v.string()),
});
type CourseLanguages = Infer<typeof courseLanguagesValidator>;

/**
 * Read the active course's base and target language codes so chat-voice
 * transcription knows which languages the utterance is likely to mix. They're
 * returned separately because the two play different roles: the union decides
 * whether Azure's multi-lingual model covers the course, while `target` is the
 * single locale we pin to if language-ID gives up on mixed audio. Both arrays
 * are empty when the user has no active course.
 */
export const getActiveCourseLanguages = internalQuery({
  args: { userId: v.string() },
  returns: courseLanguagesValidator,
  handler: async (ctx, { userId }) => {
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { base: [], target: [] };
    const { course } = active;
    return {
      base: [...new Set(course.baseLanguages)],
      target: [...new Set(course.targetLanguages)],
    };
  },
});

/**
 * Transcribe audio for chat voice input. Wraps the shared STT helper in
 * `../../lib/stt` with auth + quota.
 *
 * Language handling, when nothing is pinned, has two modes and one fallback:
 *  - Course fully covered by Azure's multi-lingual model → that model runs, and
 *    an utterance that switches languages mid-sentence transcribes as spoken.
 *  - Otherwise → candidate-locale language-ID over the 8 most-common languages
 *    plus the course's, so dialect codes (Iraqi Arabic, Cantonese, etc.)
 *    participate even when outside the global top-N.
 *  - Language-ID picks one dominant locale per recording and 422s on genuinely
 *    mixed audio. Rather than losing the recording, retry once pinned to the
 *    course's target language — the one the user is practising, so it's the
 *    half of a mixed utterance worth getting right. With no course to pin to,
 *    the multi-lingual model is the last resort.
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

    const courseLanguages: CourseLanguages = args.language
      ? { base: [], target: [] }
      : await ctx.runQuery(
          internal.features.chat.transcribe.getActiveCourseLanguages,
          { userId },
        );

    const startedAt = Date.now();
    let sttCalls = 0;
    const runOnce = async (
      blob: Blob,
      language: string | undefined,
      opts: Parameters<typeof runStt>[2],
    ) => {
      await reserveAzureSttSlot(ctx, { maxWaitMs: 3000 });
      sttCalls += 1;
      return runStt(blob, language, opts);
    };

    try {
      const baseMime = (args.mimeType ?? 'audio/webm').split(';')[0].trim();
      const blob = new Blob([args.audio], { type: baseMime });
      const autoDetectCourseLanguages = [
        ...new Set([...courseLanguages.base, ...courseLanguages.target]),
      ];

      let result;
      try {
        result = await runOnce(blob, args.language, {
          ...(args.language
            ? { regionVariant: args.regionVariant }
            : { autoDetectCourseLanguages }),
        });
      } catch (error) {
        // Only the auto-detect path can hit this: a pinned language means one
        // candidate locale, so there's no language-ID to give up.
        if (args.language || !(error instanceof AzureMultipleLanguagesError)) {
          throw error;
        }
        // Mixed-language audio that candidate-locale language-ID refused.
        // Pin the target language if we know one, else fall back to the
        // multi-lingual model and take whatever it covers.
        const pinned = courseLanguages.target[0];
        result = pinned
          ? await runOnce(blob, pinned, {})
          : await runOnce(blob, undefined, { forceMultilingualModel: true });
      }
      const { text, audioDurationMs } = result;

      await captureGeneration(ctx, {
        distinctId: userId,
        feature: 'chat_voice_input',
        model: 'azure-fast-transcription',
        provider: 'azure',
        latencyMs: Date.now() - startedAt,
        // Azure bills every attempt, so a retried recording costs twice.
        costUsd:
          audioDurationMs !== undefined
            ? costForAudioMs('azureStt', audioDurationMs) * sttCalls
            : undefined,
        extra: {
          audio_duration_ms: audioDurationMs,
          transcript_chars: text.length,
          stt_calls: sttCalls,
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
