/**
 * Single STT provider: Azure Speech Fast Transcription. All transcription
 * goes through `transcribeAudio` below. Kept as its own module so a future
 * provider swap is a one-line change here.
 */
export { transcribeAudio, reserveAzureSttSlot, type WordTiming } from './azure';
export { toAzureSttLocale, AUTO_DETECT_LOCALES } from './languageCodes';
