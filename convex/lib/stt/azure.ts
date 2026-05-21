/**
 * Azure Speech Fast Transcription — used app-wide for STT.
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
import { rateLimiter } from '../../rateLimiter';
import { buildAutoDetectLocales, toAzureSttLocales } from './languageCodes';

/**
 * Reserve a slot in the `azureStt` token bucket before an Azure STT call.
 * Background callers (TTS validation, word-timing backfill) pass no max and
 * wait out the bucket. Interactive callers (chat voice) pass `maxWaitMs` so
 * a saturated bucket fast-fails into a user-facing "busy" error instead of
 * hanging the mic button for tens of seconds.
 *
 * Fast-fail uses `check` (non-consuming) before `limit` (consuming) so a
 * rejected interactive call doesn't burn a reservation it then walks away
 * from. There is a small race — another caller may grab a token between
 * check and limit — but the resulting overshoot is bounded by one extra
 * reservation, which is fine.
 */
export async function reserveAzureSttSlot(
  ctx: ActionCtx,
  opts: { maxWaitMs?: number } = {},
): Promise<void> {
  if (opts.maxWaitMs != null) {
    const peek = await rateLimiter.check(ctx, 'azureStt', { reserve: true });
    const projectedWait = peek.retryAfter;
    if (!peek.ok || (projectedWait != null && projectedWait > opts.maxWaitMs)) {
      const retryHint =
        projectedWait != null
          ? `try again in ${Math.ceil(projectedWait / 1000)}s`
          : 'try again shortly';
      throw new Error(`Azure STT busy — ${retryHint}`);
    }
  }

  const result = await rateLimiter.limit(ctx, 'azureStt', { reserve: true });
  if (!result.ok) {
    // Only reachable if `maxReserved` is ever configured on the bucket.
    throw new Error('Azure STT reservation pool full — try again later');
  }
  const wait = result.retryAfter ?? 0;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
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
   * single-element `[regionVariant]` — used for TTS validation, where the
   * synthesized voice's locale is already known so we skip language-ID.
   */
  regionVariant?: string;
  /**
   * Course languages (internal codes) used when auto-detecting. Appended to
   * the 8 most-common base locales, deduped, capped at Azure's 10-locale
   * limit. Pass the active course's base ∪ target codes; `es_mixed` is
   * automatically expanded to `es-ES` + `es-MX`.
   */
  autoDetectCourseLanguages?: readonly string[];
}

const API_VERSION = '2024-11-15';

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
 * passed as the only candidate — best accuracy. When omitted, Azure auto-
 * detects from `AUTO_DETECT_LOCALES`.
 */
export async function transcribeAudio(
  blob: Blob,
  internalLanguageCode?: string,
  opts: TranscribeOptions = {},
): Promise<{ text: string; wordTimings: WordTiming[] }> {
  const apiKey = process.env.AZURE_SPEECH_API_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!apiKey) throw new Error('AZURE_SPEECH_API_KEY is not configured');
  if (!region) throw new Error('AZURE_SPEECH_REGION is not configured');

  const locales = internalLanguageCode
    ? toAzureSttLocales(internalLanguageCode, opts.regionVariant)
    : buildAutoDetectLocales(opts.autoDetectCourseLanguages);

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
    throw new Error(
      `Azure STT API error: ${response.status} - ${errorText}`,
    );
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

  return { text, wordTimings };
}
