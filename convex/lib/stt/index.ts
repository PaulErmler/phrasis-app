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
import { getSttBackend } from '../../../lib/languages';
import { OPENROUTER_MODELS } from '../../config/aiModels';
import { transcribeAudioWithGemini } from './gemini';
import {
  transcribeAudio as transcribeAudioWithMai,
  type TranscribeOptions,
  type TranscriptionResult,
} from './openrouter';

/**
 * Transcribe an audio Blob with the backend the language is routed to.
 * Without a language hint (chat voice input auto-detect) MAI runs: it is the
 * backend that detects languages and handles code switching.
 */
export function transcribeAudio(
  blob: Blob,
  internalLanguageCode?: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const backend = internalLanguageCode
    ? getSttBackend(internalLanguageCode)
    : 'mai-transcribe-2';
  return backend === 'gemini-flash-lite'
    ? transcribeAudioWithGemini(blob, internalLanguageCode, opts)
    : transcribeAudioWithMai(blob, internalLanguageCode, opts);
}

/** OpenRouter model slug the language's STT runs on, for cost-event labels. */
export function sttModelForLanguage(internalLanguageCode?: string): string {
  return internalLanguageCode &&
    getSttBackend(internalLanguageCode) === 'gemini-flash-lite'
    ? OPENROUTER_MODELS.sttGemini
    : OPENROUTER_MODELS.stt;
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
