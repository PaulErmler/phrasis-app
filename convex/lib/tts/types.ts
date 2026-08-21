/**
 * TTS provider interface. One class per provider (Google, Azure, Gemini);
 * all synthesis flows through `getTtsProvider(id).speak(...)` so callers
 * never touch provider-specific HTTP calls.
 */
import type { TtsProvider } from '../../types';

export interface SpeakInput {
  text: string;
  /** Internal language code (e.g. `'en'`, `'es_latam'`, `'zh'`). */
  language: string;
  /** Provider-specific voice id, e.g. Google voice name or Azure short name. */
  voiceApiCode: string;
  /** Playback speed; 1.0 = normal. */
  speed: number;
}

export interface SpeakResult {
  /** MP3 audio as a Blob. Uniform output shape across providers. */
  audio: Blob;
  provider: TtsProvider;
}

export interface TTSProvider {
  readonly id: TtsProvider;
  speak(input: SpeakInput): Promise<SpeakResult>;
}
