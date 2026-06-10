import type { SpeakInput, SpeakResult, TTSProvider } from './types';
import { Mp3Encoder } from '@breezystack/lamejs';
import { toGeminiBcp47 } from './languageCodes';

// Gemini 3.1 Flash TTS, reached through OpenRouter's OpenAI-compatible speech
// endpoint. OpenRouter only emits PCM for this model (it 400s on response_format
// mp3 and 404s the chat-completions audio modality), so we request PCM and
// transcode to MP3 below — keeping stored audio compact and browser-playable
// like every other provider. Reuses the same OPENROUTER_API_KEY as translation
// (features/translationLLM.ts).
const MODEL = 'google/gemini-3.1-flash-tts-preview';
const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';

// Gemini PCM is 24 kHz / 16-bit / mono. 64 kbps mono MP3 keeps speech clear at
// roughly an eighth the size of the equivalent WAV.
const PCM_SAMPLE_RATE = 24000;
const MP3_KBPS = 64;

/**
 * Natural-language style instruction sent in `provider.options.google.prompt`.
 * These are isolated example sentences a learner is studying, so we want
 * steady, well-articulated delivery rather than performance. `speed` is folded
 * in here because the OpenRouter speech endpoint's top-level `speed` param is
 * OpenAI-only — Gemini ignores it, so pace has to ride in the prompt.
 */
function buildStylePrompt(speed: number): string {
  const base =
    'Read the sentence clearly and naturally, like a language tutor giving a ' +
    'learner a clean example to imitate. Use neutral, standard pronunciation.';
  if (speed < 0.95) return `${base} Speak slowly and deliberately.`;
  if (speed > 1.05) return `${base} Speak at a brisk pace.`;
  return base;
}

/**
 * Transcode raw little-endian PCM (24 kHz, 16-bit, mono — Gemini's only output
 * via OpenRouter) to MP3. Pure-JS encoder, so it runs in the Convex runtime
 * (no Node `Buffer` or native addons).
 */
function pcmToMp3(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  // Reinterpret the byte stream as signed 16-bit samples. Int16Array uses the
  // platform's native byte order — little-endian in the Convex runtime, which
  // matches the PCM Gemini returns.
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.byteLength / 2),
  );
  const encoder = new Mp3Encoder(1, PCM_SAMPLE_RATE, MP3_KBPS);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const BLOCK = 1152; // one MP3 granule
  for (let i = 0; i < samples.length; i += BLOCK) {
    const enc = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
    if (enc.length > 0) {
      chunks.push(enc);
      total += enc.length;
    }
  }
  const tail = encoder.flush();
  if (tail.length > 0) {
    chunks.push(tail);
    total += tail.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export const geminiTts: TTSProvider = {
  id: 'gemini',
  async speak(input: SpeakInput): Promise<SpeakResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        input: input.text,
        // The voice apiCode is the bare Gemini voice name, e.g. "Kore".
        voice: input.voiceApiCode,
        // OpenRouter only accepts 'pcm' for this model; we transcode to MP3 below.
        response_format: 'pcm',
        // Passed through too (harmless if ignored); the real pace control is the
        // prompt hint above.
        speed: input.speed,
        // Provider-specific options: language steering + style prompt. The
        // `google` slug is matched by OpenRouter for the Gemini model.
        provider: {
          options: {
            google: {
              language_code: toGeminiBcp47(input.language),
              prompt: buildStylePrompt(input.speed),
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini TTS API error: ${response.status} - ${errorText}`);
    }

    const pcm = new Uint8Array(await response.arrayBuffer());
    if (pcm.byteLength === 0) {
      throw new Error('No audio content returned from Gemini TTS API');
    }
    // Gemini emits headerless PCM; transcode to MP3 so the stored Blob matches
    // the other providers' output (google/azure both label it 'audio/mp3') and
    // plays in the browser.
    return {
      audio: new Blob([pcmToMp3(pcm)], { type: 'audio/mp3' }),
      provider: 'gemini',
    };
  },
};
