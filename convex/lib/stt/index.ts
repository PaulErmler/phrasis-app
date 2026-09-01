/**
 * Single STT provider: Azure Speech Fast Transcription. All transcription
 * goes through `transcribeAudio` below. Kept as its own module so a future
 * provider swap is a one-line change here.
 */
export {
  transcribeAudio,
  reserveAzureSttSlot,
  AzureMultipleLanguagesError,
  type WordTiming,
} from './azure';
export {
  toAzureSttLocale,
  supportsMultilingualModel,
  AUTO_DETECT_LOCALES,
} from './languageCodes';
