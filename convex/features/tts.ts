/**
 * Shared TTS helper — used by features/decks.ts and testing/tts.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Text-comparison utilities (normalizeForComparison, textsMatch) live
 * in ../lib/textComparison.ts and are re-exported here for convenience.
 */

import { OPENAI_TRANSCRIPTION_MODEL } from '../config/aiModels';
import type { TtsProvider } from '../types';

export { normalizeForComparison, textsMatch } from '../lib/textComparison';

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

/**
 * OpenAI audio transcription expects an ISO-639-1 language code (e.g. `es`).
 * App-internal codes (e.g. `es_latam` for Latin American Spanish) must map to
 * that form — regional Spanish variants still use `es` for the API.
 *
 * @see https://platform.openai.com/docs/guides/speech-to-text
 */
function toOpenAITranscriptionLanguage(internalCode: string): string {
  const map: Record<string, string> = {
    es_latam: 'es',
  };
  return map[internalCode] ?? internalCode;
}

/**
 * Transcribe an audio Blob via the OpenAI transcriptions API.
 * Used internally for TTS validation — no auth or quota checks.
 */
export async function transcribeAudio(
  blob: Blob,
  languageCode: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const openAiLang = toOpenAITranscriptionLanguage(languageCode);

  const file = new File([blob], 'audio.mp3', { type: 'audio/mp3' });
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', OPENAI_TRANSCRIPTION_MODEL);
  formData.append('language', openAiLang);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI transcription failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}

