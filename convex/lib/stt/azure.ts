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

import { AUTO_DETECT_LOCALES, toAzureSttLocale } from './languageCodes';

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
): Promise<{ text: string; wordTimings: WordTiming[] }> {
  const apiKey = process.env.AZURE_SPEECH_API_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!apiKey) throw new Error('AZURE_SPEECH_API_KEY is not configured');
  if (!region) throw new Error('AZURE_SPEECH_REGION is not configured');

  const locales = internalLanguageCode
    ? [toAzureSttLocale(internalLanguageCode)]
    : [...AUTO_DETECT_LOCALES];

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
