/**
 * Active TTS providers. Register a provider here to enable it; any code path
 * that resolves it via `getTtsProvider(id)` will then succeed. Inactive
 * providers keep their implementation file so re-enabling is a one-line flip.
 */
import type { TtsProvider } from '../../types';
import type { TTSProvider } from './types';
import { googleTts } from './google';
import { azureTts } from './azure';
import { geminiTts } from './gemini';

const providers: Partial<Record<TtsProvider, TTSProvider>> = {
  google: googleTts,
  azure: azureTts,
  gemini: geminiTts,
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
