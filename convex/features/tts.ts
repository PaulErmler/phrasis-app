/**
 * Shared TTS helper — used by features/decks.ts and testing/tts.ts.
 * No Convex function exports; just plain async helpers.
 *
 * Text-comparison utilities (normalizeForComparison, textsMatch) live
 * in ../lib/textComparison.ts and are re-exported here for convenience.
 */

export { normalizeForComparison, textsMatch } from '../lib/textComparison';

/** Google TTS API response type */
interface GoogleTTSResponse {
  audioContent: string; // Base64-encoded audio
}

/**
 * Extract languageCode from voiceName (e.g., "en-US-Chirp3-HD-Leda" -> "en-US")
 */
function extractLanguageCode(voiceName: string): string {
  return voiceName.split('-Chirp3-HD-')[0];
}

/**
 * Call the Google Cloud TTS REST API.
 * Returns a Blob of the synthesized MP3 audio. Throws on any error.
 */
export async function synthesizeSpeech(
  text: string,
  voiceName: string,
  speed: number,
): Promise<Blob> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('TTS service not configured');

  const languageCode = extractLanguageCode(voiceName);

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as GoogleTTSResponse;
  if (!data.audioContent)
    throw new Error('No audio content returned from Google TTS API');

  return new Blob(
    [Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0))],
    { type: 'audio/mp3' },
  );
}

/**
 * Transcribe an audio Blob via the OpenAI transcriptions API.
 * Used internally for TTS validation — no auth or quota checks.
 */
export async function transcribeAudio(
  blob: Blob,
  languageCode: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const file = new File([blob], 'audio.mp3', { type: 'audio/mp3' });
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('language', languageCode);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI transcription failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}

