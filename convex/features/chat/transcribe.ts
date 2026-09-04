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
  reserveSttSlot,
  normalizeTranscriptScript,
  resolveScriptTarget,
  containerOfBuffer,
  sttCostForEvent,
  STT_REJECTED_CONTAINERS,
} from '../../lib/stt';
import { getActiveCourseForUser } from '../../db/courses';
import { EVENTS, track } from '../../analytics';
import { captureGeneration } from '../../lib/posthogAi';
import { OPENROUTER_MODELS } from '../../config/aiModels';

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
 * Read the active course's base and target language codes. Auto-detected
 * chat transcripts use them to settle which script a Mandarin or Cantonese
 * transcript should be returned in (see `resolveScriptTarget`): the model
 * reports only `zh` / `yue`, and the course is what says whether that means
 * Simplified or Traditional here. Both arrays are empty when the user has
 * no active course.
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
 * Transcribe audio for chat and writing-mode voice input. Wraps the shared
 * STT helper in `../../lib/stt` with auth + quota.
 *
 * The container check runs before the quota is consumed: a client bundle
 * from before the WAV transcode (hooks/use-voice-recording.ts) still uploads
 * WebM or MP4, which the provider rejects, and it should get a structured
 * error rather than a charge. After the quota there is exactly one STT
 * call. With no pinned language the model auto-detects, and an utterance
 * that switches languages mid-sentence transcribes as spoken, so there is
 * no mixed-language retry.
 *
 * Script: the model writes Serbian in Latin and Mandarin in Simplified
 * whatever the app expects. A pinned call converts into the pinned
 * language's script; an auto-detected call converts when the detected
 * language plus the course's languages identify one app language.
 */
export const transcribeAudio = action({
  args: {
    audio: v.bytes(),
    mimeType: v.optional(v.string()),
    // Pin transcription to one language (internal code) instead of
    // auto-detecting. Used by writing-mode voice input, where the row's
    // target language is already known: the hint gives the model its best
    // accuracy and decides which script the transcript comes back in.
    language: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const container = containerOfBuffer(args.audio);
    if (STT_REJECTED_CONTAINERS.has(container)) {
      // Tracked so a stale-bundle wave shows up next to real failures.
      await track(ctx, userId, EVENTS.VOICE_TRANSCRIPTION_FAILED, {
        latency_ms: 0,
        message: `unsupported audio container: ${container}`,
      });
      throw new ConvexError({
        code: 'UNSUPPORTED_AUDIO',
        message: `Recording format "${container}" is not supported; reload the app and try again`,
      });
    }

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
    try {
      const baseMime = (args.mimeType ?? 'audio/wav').split(';')[0].trim();
      const blob = new Blob([args.audio], { type: baseMime });

      await reserveSttSlot(ctx, { maxWaitMs: 3000 });
      // One retry only: the user is waiting on this call.
      const raw = await runStt(blob, args.language, { maxRetries: 1 });
      const scriptTarget =
        args.language ??
        resolveScriptTarget(raw.detectedLanguage, [
          ...courseLanguages.base,
          ...courseLanguages.target,
        ]);
      const { text, audioDurationMs, billedSeconds, detectedLanguage } =
        normalizeTranscriptScript(raw, scriptTarget);

      const cost = sttCostForEvent(raw);
      await captureGeneration(ctx, {
        distinctId: userId,
        feature: 'chat_voice_input',
        model: OPENROUTER_MODELS.stt,
        provider: 'openrouter',
        latencyMs: Date.now() - startedAt,
        costUsd: cost.costUsd,
        extra: {
          audio_duration_ms: audioDurationMs,
          billed_seconds: billedSeconds,
          transcript_chars: text.length,
          detected_language: detectedLanguage,
          pinned_language: args.language,
          cost_source: cost.source,
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
