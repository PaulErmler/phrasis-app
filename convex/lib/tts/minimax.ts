import type { SpeakInput, SpeakResult, TTSProvider } from './types';
import { requireEnv } from '../env';
import { MAX_RETRIES, isRetryableStatus, retryDelayMs } from '../httpRetry';

// MiniMax Speech 2.8 Turbo, reached through OpenRouter's OpenAI-compatible
// speech endpoint, same endpoint + OPENROUTER_API_KEY as the Gemini provider,
// but a much simpler contract: `response_format: 'mp3'` works (no PCM
// transcode needed) and the raw sentence goes in `input` (no instruction
// wrapper. The voice itself pins language + dialect, reinforced by the
// `language_boost` provider option below).
//
// Adopted for Cantonese (Aug 2026): Chirp3-HD consistently mispronounced 唔,
// and Gemini TTS has no Cantonese at all. MiniMax ships native Cantonese
// system voices (`Cantonese_*` ids), listener-verified with correct
// vernacular readings (唔 = m4). NOTE the voice ids use a FULLWIDTH opening
// paren + ASCII closing paren, e.g. `Cantonese_ProfessionalHost（F)`. The
// all-ASCII form errors upstream (verified live).
const MODEL = 'minimax/speech-2.8-turbo';
const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';

// MiniMax's dialect hint. Only Cantonese routes to this provider today; if
// another language ever does, this must become a per-language lookup ("Chinese,
// Yue" is the documented value for Cantonese, comma included).
const LANGUAGE_BOOST = 'Chinese,Yue';

// MP3 responses start with an ID3 tag or an MPEG frame sync. Anything else
// (HTML error page, empty body, raw PCM) must fail loudly rather than be
// stored as a "playable" blob.
function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return id3 || frameSync;
}

export const minimaxTts: TTSProvider = {
  id: 'minimax',
  async speak(input: SpeakInput): Promise<SpeakResult> {
    const apiKey = requireEnv('OPENROUTER_API_KEY');

    let lastError = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          input: input.text,
          voice: input.voiceApiCode,
          response_format: 'mp3',
          // Accepted without error at any value (verified live); the pipeline
          // only ever synthesizes at 1. Playback speed is client-side.
          speed: input.speed,
          provider: {
            options: {
              minimax: { language_boost: LANGUAGE_BOOST },
            },
          },
        }),
      });

      if (!response.ok) {
        lastError = `MiniMax TTS API error: ${response.status} - ${await response.text()}`;
        if (!isRetryableStatus(response.status)) throw new Error(lastError);
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelayMs(response, attempt)),
          );
        }
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (looksLikeMp3(bytes)) {
        return {
          audio: new Blob([bytes], { type: 'audio/mp3' }),
          provider: 'minimax',
        };
      }
      lastError = `MiniMax TTS returned non-MP3 payload (${bytes.byteLength} bytes)`;
      console.warn(
        `[minimaxTts] ${lastError} for "${input.text.slice(0, 40)}" ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
      );
      // A 200 with a bad body is an upstream incident too. Back off like the
      // HTTP-error path instead of re-POSTing immediately.
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs(response, attempt)),
        );
      }
    }
    throw new Error(
      lastError || 'No audio content returned from MiniMax TTS API',
    );
  },
};
