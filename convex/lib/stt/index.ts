/**
 * Single STT provider: MAI-Transcribe-2 via OpenRouter. All transcription
 * goes through `transcribeAudio` below. Kept as its own module so a future
 * provider swap is a one-line change here. Only the surface the features
 * layer uses is re-exported; tests import the modules directly.
 */
export {
  transcribeAudio,
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
