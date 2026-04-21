/**
 * Dormant — not wired into the provider registry while TTS runs Google-only.
 * Re-enable by uncommenting the `elevenlabs` entry in ./index.ts and flipping
 * the relevant languages' `ttsProvider` to `'elevenlabs'` in lib/languages.ts.
 * ElevenLabs is still used for Scribe STT via `transcribeAudio` in
 * ../../features/tts.ts — that path is unrelated to this file.
 */
import type { SpeakInput, SpeakResult, TTSProvider } from './types';

const ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

/**
 * Map our internal language codes to ISO 639-1. Duplicated from
 * `toElevenLabsLanguageCode` in ../../features/tts.ts — that helper is
 * still used by the Scribe STT path. Kept inline here so this dormant file
 * has zero imports from features/ and can be re-enabled without cycle risk.
 */
function toIsoLanguageCode(internalCode: string): string {
  const map: Record<string, string> = {
    es_latam: 'es',
    cmn: 'zh',
  };
  return map[internalCode] ?? internalCode;
}

export const elevenLabsTts: TTSProvider = {
  id: 'elevenlabs',
  async speak(input: SpeakInput): Promise<SpeakResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceApiCode)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: input.text,
          model_id: ELEVENLABS_MODEL_ID,
          language_code: toIsoLanguageCode(input.language),
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: input.speed,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs TTS API error: ${response.status} - ${errorText}`,
      );
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new Error('No audio content returned from ElevenLabs TTS API');
    }
    return { audio: new Blob([bytes], { type: 'audio/mp3' }), provider: 'elevenlabs' };
  },
};
