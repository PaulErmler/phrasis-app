/**
 * Azure Speech Fast Transcription. Used app-wide for STT.
 *
 * Endpoint: POST https://{region}.api.cognitive.microsoft.com
 *   /speechtotext/transcriptions:transcribe?api-version=2024-11-15
 *
 * Authoritative for: TTS validation roundtrip (features/tts.ts), word-timing
 * backfill (features/ttsProcessing.ts), and chat voice input
 * (features/chat/transcribe.ts).
 *
 * Why Fast Transcription instead of the short-audio REST endpoint:
 *   - supports MP3, WebM, Opus, OGG, FLAC, etc. directly (no WAV transcode)
 *   - returns combined text + per-word offsets in one synchronous call
 *   - cheaper than batch, faster than the SDK path
 */

import type { ActionCtx } from '../../_generated/server';
import { requireEnv } from '../env';
import { reserveRateLimitToken } from '../rateLimitReserve';
import { buildAutoDetectLocales, toAzureSttLocales } from './languageCodes';

/**
 * Reserve a slot in the `azureStt` token bucket before an Azure STT call.
 * Every caller passes `maxWaitMs`: interactive ones (chat voice) keep it
 * tight so a saturated bucket fast-fails into a user-facing "busy" error,
 * and background ones (TTS validation, word-timing backfill) cap it so a
 * saturated bucket throws instead of sleeping a workpool worker in-slot.
 * An uncapped reservation used to pin pool slots for the full refill wait.
 */
export async function reserveAzureSttSlot(
  ctx: ActionCtx,
  opts: { maxWaitMs?: number } = {},
): Promise<void> {
  await reserveRateLimitToken(ctx, 'azureStt', opts);
}

/**
 * Optional knobs for `transcribeAudio`. Either branch hands off to
 * `toAzureSttLocales` / `buildAutoDetectLocales` so the locale-resolution
 * logic stays in `languageCodes.ts`.
 */
export interface TranscribeOptions {
  /**
   * Known regional variant (Azure locale, e.g. `"es-MX"`). When set together
   * with `internalLanguageCode`, the array of locales sent to Azure is a
   * single-element `[regionVariant]`. Used for TTS validation, where the
   * synthesized voice's locale is already known so we skip language-ID.
   */
  regionVariant?: string;
  /**
   * Course languages (internal codes) used when auto-detecting. When the
   * multi-lingual model covers all of them, the request switches to that model
   * (mixed-language audio transcribes continuously). Otherwise they're appended
   * to the 8 most-common base locales, deduped, capped at Azure's 10-locale
   * limit. Pass the active course's base ∪ target codes; `es_mixed` is
   * automatically expanded to `es-ES` + `es-MX`.
   */
  autoDetectCourseLanguages?: readonly string[];
  /**
   * Request Azure's multi-lingual model outright, whatever the course
   * languages say. Used as the last-resort retry when candidate-locale
   * language-ID has already refused mixed audio and there's no course target
   * language to pin to. Ignored when `internalLanguageCode` is set.
   */
  forceMultilingualModel?: boolean;
}

const API_VERSION = '2024-11-15';

/**
 * Thrown when Azure's candidate-locale language-ID refuses the audio because
 * it contains more than one language (HTTP 422 / `MultipleLanguagesIdentified`).
 * Distinct from a generic upstream failure because it's recoverable: retry the
 * same audio either on the multi-lingual model or pinned to a single locale.
 * See `features/chat/transcribe.ts` for the recovery policy.
 */
export class AzureMultipleLanguagesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AzureMultipleLanguagesError';
  }
}

/** Azure's 422 body carries the reason in `innerError.code`. */
function isMultipleLanguagesBody(body: string): boolean {
  return body.includes('MultipleLanguagesIdentified');
}

/** Word-level timing relative to the audio blob (seconds). */
export type WordTiming = { word: string; start: number; end: number };

interface AzureWord {
  text: string;
  offsetMilliseconds: number;
  durationMilliseconds: number;
}

interface AzurePhrase {
  offsetMilliseconds: number;
  durationMilliseconds: number;
  text: string;
  locale: string;
  confidence?: number;
  words?: AzureWord[];
}

interface AzureTranscriptionResponse {
  durationMilliseconds?: number;
  combinedPhrases?: { text: string }[];
  phrases?: AzurePhrase[];
}

/**
 * Transcribe an audio Blob via Azure Fast Transcription. Returns the joined
 * text and word-level timestamps (seconds).
 *
 * When `internalLanguageCode` is provided, the corresponding Azure locale is
 * passed as the only candidate. Best accuracy. When omitted, the locale list
 * comes from `buildAutoDetectLocales`, which either returns candidate locales
 * for language-ID or an empty list — Azure's request for its multi-lingual
 * model, the mode that transcribes code-switched audio continuously.
 *
 * Throws `AzureMultipleLanguagesError` when candidate-locale language-ID can't
 * settle on one dominant language, so callers can retry in another mode.
 */
export async function transcribeAudio(
  blob: Blob,
  internalLanguageCode?: string,
  opts: TranscribeOptions = {},
): Promise<{
  text: string;
  wordTimings: WordTiming[];
  audioDurationMs?: number;
}> {
  const apiKey = requireEnv('AZURE_SPEECH_API_KEY');
  const region = requireEnv('AZURE_SPEECH_REGION');

  const locales = internalLanguageCode
    ? toAzureSttLocales(internalLanguageCode, opts.regionVariant)
    : opts.forceMultilingualModel
      ? []
      : buildAutoDetectLocales(opts.autoDetectCourseLanguages);

  // An empty `locales` array is meaningful, not a bug: it's how Azure is asked
  // for the multi-lingual model (see `buildAutoDetectLocales`).
  const definition = JSON.stringify({
    locales,
    diarization: { enabled: false },
    profanityFilterMode: 'None',
  });

  // Validation synthesizes MP3, so that's the right default when the blob has
  // no type tag (storage blobs sometimes don't). Skip the wrap if it's set.
  const audio = blob.type ? blob : new Blob([blob], { type: 'audio/mp3' });

  const formData = new FormData();
  formData.append('definition', definition);
  formData.append('audio', audio, 'audio');

  const response = await fetch(
    `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      body: formData,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    const message = `Azure STT API error: ${response.status} - ${errorText}`;
    if (response.status === 422 && isMultipleLanguagesBody(errorText)) {
      throw new AzureMultipleLanguagesError(message);
    }
    throw new Error(message);
  }

  const data = (await response.json()) as AzureTranscriptionResponse;

  const text = data.combinedPhrases?.[0]?.text ?? '';
  const wordTimings: WordTiming[] = [];
  for (const phrase of data.phrases ?? []) {
    for (const w of phrase.words ?? []) {
      if (
        typeof w.offsetMilliseconds !== 'number' ||
        typeof w.durationMilliseconds !== 'number'
      ) {
        continue;
      }
      wordTimings.push({
        word: w.text,
        start: w.offsetMilliseconds / 1000,
        end: (w.offsetMilliseconds + w.durationMilliseconds) / 1000,
      });
    }
  }

  // Azure bills per hour of audio, and this is the figure it billed on, so
  // it is the only honest input for a cost event. Optional because the field is
  // absent on some response shapes; callers fall back to skipping the cost
  // rather than inventing one.
  return { text, wordTimings, audioDurationMs: data.durationMilliseconds };
}
