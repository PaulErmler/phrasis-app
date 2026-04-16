/**
 * Shared TTS helper — used by features/decks.ts and testing/tts.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Text-comparison utilities (normalizeForComparison, textsMatch) live
 * in ../lib/textComparison.ts and are re-exported here for convenience.
 */

import type { TtsProvider } from '../types';

export { normalizeForComparison, textsMatch } from '../lib/textComparison';

/** Word-level timing returned by Scribe, relative to the audio blob (seconds). */
export type WordTiming = { word: string; start: number; end: number };

/** Google TTS API response type */
interface GoogleTTSResponse {
  audioContent: string; // Base64-encoded audio
}

/** ElevenLabs model ID used for all synthesis. */
const ELEVENLABS_MODEL_ID = 'eleven_turbo_v2_5';
/** ElevenLabs MP3 output format: 44.1 kHz, 128 kbps — matches our existing pipeline. */
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

/**
 * Extract languageCode from a Google voice name (e.g., "en-US-Chirp3-HD-Leda" -> "en-US")
 */
function extractLanguageCode(voiceName: string): string {
  return voiceName.split('-Chirp3-HD-')[0];
}

/**
 * Map our internal language codes to ISO 639-1 language codes that ElevenLabs
 * accepts in the `language_code` parameter. App-internal codes like `es_latam`
 * and `cmn` are not valid ISO 639-1 and must be folded to their base form.
 */
export function toElevenLabsLanguageCode(internalCode: string): string {
  const map: Record<string, string> = {
    es_latam: 'es',
    cmn: 'zh',
  };
  return map[internalCode] ?? internalCode;
}

/**
 * Provider-agnostic entry point used by ttsProcessing's validation loop.
 * Dispatches to the appropriate backend based on `provider`. Both backends
 * return MP3 audio so downstream (storage, transcription validation) is uniform.
 */
export async function synthesizeSpeech(
  text: string,
  voiceName: string,
  speed: number,
  provider: TtsProvider,
  language: string,
): Promise<Blob> {
  if (provider === 'elevenlabs') {
    return synthesizeElevenLabs(text, voiceName, speed, language);
  }
  return synthesizeGoogle(text, voiceName, speed);
}

/**
 * Call the Google Cloud TTS REST API.
 * Returns a Blob of the synthesized MP3 audio. Throws on any error.
 */
async function synthesizeGoogle(
  text: string,
  voiceName: string,
  speed: number,
): Promise<Blob> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('TTS service not configured');

  const languageCode = extractLanguageCode(voiceName);

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as GoogleTTSResponse;
  if (!data.audioContent)
    throw new Error('No audio content returned from Google TTS API');

  return new Blob(
    [Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0))],
    { type: 'audio/mp3' },
  );
}

/**
 * Call the ElevenLabs text-to-speech REST API.
 * `voiceId` is the raw ElevenLabs voice_id (stored as `voiceName` on the audioRecording row).
 * Returns a Blob of the synthesized MP3 audio. Throws on any error.
 */
async function synthesizeElevenLabs(
  text: string,
  voiceId: string,
  speed: number,
  language: string,
): Promise<Blob> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        // Enforce pronunciation/normalization for the target language.
        // Accepted by flash/turbo v2.5 and v3; silently ignored by multilingual_v2.
        language_code: toElevenLabsLanguageCode(language),
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs TTS API error: ${response.status} - ${errorText}`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error('No audio content returned from ElevenLabs TTS API');
  }
  return new Blob([bytes], { type: 'audio/mp3' });
}

/** Shape of a word returned by Scribe. `start`/`end` are seconds. */
interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type: 'word' | 'spacing' | 'audio_event';
}

interface ScribeResponse {
  text: string;
  words: ScribeWord[];
  language_code?: string;
}

/**
 * Transcribe an audio Blob via the ElevenLabs Scribe v2 API. Used internally
 * for TTS validation — no auth or quota checks. Returns the transcribed text
 * plus word-level timestamps so callers can persist alignment alongside the
 * audio for later playback highlighting.
 *
 * `languageCode` is optional: when omitted, Scribe auto-detects. Callers that
 * know the language (e.g. the TTS validation loop) should pass it for better
 * accuracy. Uses raw `fetch` (like the TTS call above) so this file stays
 * V8-runtime-compatible — the ElevenLabs SDK pulls in Node built-ins.
 */
export async function transcribeAudio(
  blob: Blob,
  languageCode?: string,
): Promise<{ text: string; wordTimings: WordTiming[] }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const formData = new FormData();
  formData.append('file', blob, 'audio.mp3');
  formData.append('model_id', 'scribe_v2');
  formData.append('tag_audio_events', 'true');
  formData.append('diarize', 'true');
  formData.append('timestamps_granularity', 'word');
  if (languageCode) {
    formData.append('language_code', toElevenLabsLanguageCode(languageCode));
  }

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ElevenLabs Scribe API error: ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as ScribeResponse;

  const wordTimings: WordTiming[] = [];
  for (const w of data.words) {
    if (w.type !== 'word') continue;
    if (w.start === undefined || w.end === undefined) continue;
    wordTimings.push({ word: w.text, start: w.start, end: w.end });
  }

  return { text: data.text, wordTimings };
}

