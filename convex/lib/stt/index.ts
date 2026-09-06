/**
 * Speech-to-text entry point. Two backends, routed per language by
 * `sttBackend` in lib/languages.ts:
 *   - MAI-Transcribe-2 via OpenRouter's transcription endpoint
 *     (./openrouter.ts): the default, word timings included.
 *   - Gemini 3.1 Flash Lite via chat completions (./gemini.ts): text only,
 *     for languages MAI does not cover.
 * Features call `transcribeAudio` below and never pick a backend
 * themselves. Only the surface the features layer uses is re-exported;
 * tests import the modules directly.
 */
import { getSttBackend, type SttBackend } from '../../../lib/languages';
import { OPENROUTER_MODELS } from '../../config/aiModels';
import { transcribeAudioWithGemini } from './gemini';
import {
  transcribeAudio as transcribeAudioWithMai,
  type TranscribeOptions,
  type TranscriptionResult,
} from './openrouter';

/**
 * Where a language's speech recognition runs, as the backend and the
 * OpenRouter model slug the cost event is labelled with. Without a language
 * hint, as with chat voice input auto-detect, MAI runs, since it is the
 * backend that detects languages and handles code switching. The one
 * lookup behind both `transcribeAudio` and `sttModelForLanguage`, so the
 * label can never name a different backend than the one that transcribed.
 */
export function sttRouteForLanguage(internalLanguageCode?: string): {
  backend: SttBackend;
  model: string;
} {
  const backend = internalLanguageCode
    ? getSttBackend(internalLanguageCode)
    : 'mai-transcribe-2';
  return {
    backend,
    model:
      backend === 'gemini-flash-lite'
        ? OPENROUTER_MODELS.sttGemini
        : OPENROUTER_MODELS.stt,
  };
}

/** Transcribe an audio Blob with the backend the language is routed to. */
export function transcribeAudio(
  blob: Blob,
  internalLanguageCode?: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  return sttRouteForLanguage(internalLanguageCode).backend ===
    'gemini-flash-lite'
    ? transcribeAudioWithGemini(blob, internalLanguageCode, opts)
    : transcribeAudioWithMai(blob, internalLanguageCode, opts);
}

/** OpenRouter model slug the language's STT runs on, for cost-event labels. */
export function sttModelForLanguage(internalLanguageCode?: string): string {
  return sttRouteForLanguage(internalLanguageCode).model;
}

export {
  reserveSttSlot,
  type WordTiming,
  type TranscriptionResult,
} from './openrouter';
export { sttCostForEvent } from './cost';
export {
  normalizeTranscriptScript,
  resolveScriptTarget,
} from './scriptNormalize';
export { containerOfBuffer, STT_REJECTED_CONTAINERS } from './audioContainer';
