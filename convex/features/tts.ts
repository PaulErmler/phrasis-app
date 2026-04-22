/**
 * Shared TTS helper — used by features/decks.ts and testing/tts.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Provider-specific synthesis lives behind the `TTSProvider` interface in
 * ../lib/tts; this module is just the call site + the Scribe STT helper.
 * Text-comparison utilities live in ../lib/textComparison.ts and are
 * re-exported here for convenience.
 */

import type { TtsProvider } from '../types';
import { getTtsProvider } from '../lib/tts';
import { toElevenLabsLanguageCode } from '../lib/tts/languageCodes';

export { normalizeForComparison, textsMatch } from '../lib/textComparison';
export { toElevenLabsLanguageCode } from '../lib/tts/languageCodes';

/** Word-level timing returned by Scribe, relative to the audio blob (seconds). */
export type WordTiming = { word: string; start: number; end: number };

/**
 * Provider-agnostic entry point used by ttsProcessing's validation loop.
 * Dispatches through the `TTSProvider` registry so adding a new backend is
 * a new file in ../lib/tts, not another branch in this function.
 */
export async function synthesizeSpeech(
  text: string,
  voiceName: string,
  speed: number,
  provider: TtsProvider,
  language: string,
): Promise<Blob> {
  const { audio } = await getTtsProvider(provider).speak({
    text,
    language,
    voiceApiCode: voiceName,
    speed,
  });
  return audio;
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
  // TTS validation blobs are always single-speaker, so diarization adds cost
  // and latency without producing useful information.
  formData.append('diarize', 'false');
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
