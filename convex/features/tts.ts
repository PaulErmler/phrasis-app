/**
 * Shared TTS + STT helper. Used by features/decks.ts and features/ttsProcessing.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Provider-specific TTS synthesis lives behind the `TTSProvider` interface in
 * ../lib/tts. Speech-to-text goes through ../lib/stt (Azure Fast
 * Transcription, sole STT provider). Text-comparison utilities live in
 * ../lib/textComparison.ts and are re-exported here for convenience.
 */

import type { TtsProvider } from '../types';
import { getTtsProvider } from '../lib/tts';

export { normalizeForComparison, textsMatch } from '../lib/textComparison';
export { transcribeAudio, reserveAzureSttSlot, type WordTiming } from '../lib/stt';

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
