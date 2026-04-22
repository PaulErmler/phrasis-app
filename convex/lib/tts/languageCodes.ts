/**
 * Map our internal language codes to ISO 639-1 codes that ElevenLabs APIs
 * accept. App-internal codes like `es_latam` and `cmn` aren't valid ISO 639-1
 * and must be folded to their base form. Used by both the Scribe STT path
 * (features/tts.ts) and the ElevenLabs TTS provider (lib/tts/elevenlabs.ts).
 */
export function toElevenLabsLanguageCode(internalCode: string): string {
  const map: Record<string, string> = {
    es_latam: 'es',
    cmn: 'zh',
  };
  return map[internalCode] ?? internalCode;
}
