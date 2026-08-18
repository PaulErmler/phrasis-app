/**
 * Active TTS providers. Register a provider here to enable it; any code path
 * that resolves it via `getTtsProvider(id)` will then succeed. Inactive
 * providers keep their implementation file so re-enabling is a one-line flip.
 */
import type { TtsProvider } from '../../types';
import type { TTSProvider } from './types';
import { googleTts } from './google';
import { geminiTts } from './gemini';
import { minimaxTts } from './minimax';

// 'azure' and 'elevenlabs' are retired: they linger in `TtsProvider` only as
// stored-value tombstones (historical `audioRecordings.ttsProvider` rows) and
// are not dispatchable. Azure Speech is still used for STT (convex/lib/stt).
const providers: Partial<Record<TtsProvider, TTSProvider>> = {
  google: googleTts,
  gemini: geminiTts,
  minimax: minimaxTts,
};

export function getTtsProvider(id: TtsProvider): TTSProvider {
  const p = providers[id];
  if (!p) {
    throw new Error(
      `TTS provider not active: ${id}. Enable it in convex/lib/tts/index.ts.`,
    );
  }
  return p;
}

export type { TTSProvider, SpeakInput, SpeakResult } from './types';
