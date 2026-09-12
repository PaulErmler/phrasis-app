/**
 * TTS provider interface. One object per provider (Google, Gemini, MiniMax);
 * all synthesis flows through `getTtsProvider(id).speak(...)` so callers
 * never touch provider-specific HTTP calls.
 */
import type { TtsProvider } from '../../types';

export interface SpeakInput {
  text: string;
  /** Internal language code (e.g. `'en'`, `'es_latam'`, `'zh'`). */
  language: string;
  /** Provider-specific voice id, e.g. Google voice name or MiniMax voice id. */
  voiceApiCode: string;
  /** Playback speed; 1.0 = normal. */
  speed: number;
}

export interface SpeakResult {
  /** MP3 audio as a Blob. Uniform output shape across providers. */
  audio: Blob;
  provider: TtsProvider;
  /**
   * OpenRouter generation ids, one per BILLED request. Empty for providers
   * that don't go through OpenRouter (Google).
   *
   * One clip can be several charges: both OpenRouter providers re-POST after a
   * 200 that billed but returned unusable audio (Gemini's empty PCM, MiniMax's
   * non-MP3 body), so the ids accumulate across those attempts. The caller
   * prices them with `generationCostUsd`; `/audio/speech` reports no usage
   * inline, so this is the only route to the real figure.
   */
  generationIds: string[];
}

export interface TTSProvider {
  readonly id: TtsProvider;
  speak(input: SpeakInput): Promise<SpeakResult>;
}

/**
 * A synthesis that gave up after billing.
 *
 * Both OpenRouter providers retry internally (Gemini on an empty 200, MiniMax
 * on a non-MP3 body) and can still end with nothing usable. Those attempts
 * were charged, so the ids travel with the error instead of dying with it —
 * otherwise the most expensive outcome, a clip that burned every attempt and
 * produced no audio, is the one that reports no cost.
 */
export class TtsSynthesisFailedError extends Error {
  constructor(
    message: string,
    readonly generationIds: string[],
    /** The provider error this wraps. Assigned directly: the Convex runtime's
     *  lib target predates `new Error(message, { cause })`. */
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TtsSynthesisFailedError';
  }
}

/** Generation ids a failed synthesis already paid for. Empty for any other error. */
export function failedSynthesisGenerationIds(err: unknown): string[] {
  return err instanceof TtsSynthesisFailedError ? err.generationIds : [];
}
