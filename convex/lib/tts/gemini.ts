import type { SpeakInput, SpeakResult, TTSProvider } from './types';
import { Mp3Encoder } from '@breezystack/lamejs';
import { toGeminiBcp47 } from './languageCodes';
import { getLanguageByCode } from '../../../lib/languages';
import { trimTailHiccup } from './tailTrim';

// Gemini 3.1 Flash TTS, reached through OpenRouter's OpenAI-compatible speech
// endpoint. OpenRouter emits ONLY raw PCM for this model — its response_format
// enum is exactly ["mp3","pcm"], and "mp3" hard-400s with
// "Gemini TTS only supports response_format=\"pcm\"". (OpenRouter's generic docs
// imply mp3 works for any model; it does NOT for this one. Verified live —
// re-run `pnpm tts:probe` if that ever changes.) So we request PCM and transcode
// to MP3 below — keeping stored audio compact and browser-playable like every
// other provider. opus/wav aren't accepted either, and Gemini natively emits
// only PCM, so the transcode has to happen in the Convex runtime. Reuses the
// same OPENROUTER_API_KEY as translation (features/translationLLM.ts).
const MODEL = 'google/gemini-3.1-flash-tts-preview';
const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';

// Gemini PCM is 24 kHz / 16-bit / mono. 48 kbps mono MP3 keeps speech clear and
// matches the azure provider's setting (lib/tts/azure.ts), which already passes
// the same Azure STT validation roundtrip — ~25% smaller than 64 kbps and a
// fraction of the equivalent WAV.
const PCM_SAMPLE_RATE = 24000;
const MP3_KBPS = 48;

// The Int16Array decode in pcmToMp3 reads samples in the host's native byte
// order. Gemini's PCM is little-endian, which matches the Convex V8 runtime, so
// in practice this is always true; we detect it anyway and byte-swap on a
// (theoretical) big-endian host rather than silently emitting corrupted audio.
const HOST_IS_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;


function buildStyledInput(text: string, languageName: string): string {
  const context =
    `Speak the following text in a natural way like a native ${languageName} speaker would in a way that fits the sentence.`;
  return `## Instruction: ${context}\n\n## Transcript: ${text}`;
}

/**
 * Transcode raw little-endian PCM (24 kHz, 16-bit, mono — Gemini's only output
 * via OpenRouter) to MP3. Pure-JS encoder, so it runs in the Convex runtime
 * (no Node `Buffer` or native addons).
 */
function pcmToMp3(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  // 16-bit mono PCM is always an even number of bytes (2 per sample). An odd
  // length means the stream was truncated/corrupted — fail loudly rather than
  // silently dropping the trailing byte and emitting garbled audio.
  if (pcm.byteLength % 2 !== 0) {
    throw new Error(
      `Gemini PCM byte length must be even (16-bit samples); got ${pcm.byteLength}`,
    );
  }
  // Reinterpret the byte stream as signed 16-bit samples. Int16Array uses the
  // host's native byte order; Gemini's PCM is little-endian, so on a big-endian
  // host we byte-swap a copy first. No-op (and no copy) on little-endian, which
  // is the Convex runtime.
  let bytes = pcm;
  if (!HOST_IS_LITTLE_ENDIAN) {
    bytes = pcm.slice();
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const lo = bytes[i];
      bytes[i] = bytes[i + 1];
      bytes[i + 1] = lo;
    }
  }
  const samples = new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 2),
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

/**
 * Split a Gemini voice apiCode into the bare voice name and an optional
 * accent locale. Pools for multi-accent languages (English: US/GB/AU) encode
 * the locale as `"<Name>@<bcp47>"` (e.g. "Kore@en-GB") because the accent
 * can't be derived from the language code; single-accent languages (de, sv,
 * pt_pt) use the bare name and rely on `toGeminiBcp47`. See lib/voices.ts.
 */
function parseVoiceApiCode(apiCode: string): {
  voiceName: string;
  locale?: string;
} {
  const at = apiCode.indexOf('@');
  const voiceName = at === -1 ? apiCode : apiCode.slice(0, at);
  if (!voiceName) {
    throw new Error(
      `Invalid Gemini voice apiCode "${apiCode}": missing voice name`,
    );
  }
  if (at === -1) return { voiceName };
  // A trailing "@" with no locale ("Kore@") would become an empty
  // language_code and hard-400 the OpenRouter request — reject it here.
  const locale = apiCode.slice(at + 1);
  if (!locale) {
    throw new Error(
      `Invalid Gemini voice apiCode "${apiCode}": missing locale after "@"`,
    );
  }
  return { voiceName, locale };
}

/** One PCM synthesis request. Returns raw headerless PCM (possibly zero-byte —
 * the caller decides whether to retry). Throws on a non-2xx HTTP response. */
async function requestGeminiPcm(
  apiKey: string,
  args: {
    /** Full request text — the "## Context … ## Transcript …" block. */
    input: string;
    voiceName: string;
    languageCode: string;
    speed: number;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: args.input,
      // The bare Gemini voice name, e.g. "Kore" (any `@<locale>` accent suffix
      // is parsed off by the caller and applied as language_code below).
      voice: args.voiceName,
      // OpenRouter only accepts 'pcm' for this model; we transcode to MP3 below.
      response_format: 'pcm',
      // Top-level speed is OpenAI-only (Gemini ignores it); the real pace control
      // rides in the "## Context" block of `input`. Passed through harmlessly.
      speed: args.speed,
      // Provider options: only language_code (base-language / accent steer). The
      // `prompt` field is NOT sent — OpenRouter drops it for this model, so the
      // style instruction lives inside `input` instead (Strategy C).
      provider: {
        options: {
          google: {
            language_code: args.languageCode,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini TTS API error: ${response.status} - ${errorText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Gemini (via OpenRouter) intermittently returns an empty (zero-byte) 200 for an
// otherwise-valid request. Padding the input with a space perturbs it just
// enough to dislodge the empty result, so on an empty response we retry, each
// time randomly adding a space at the front and/or end (50% chance each). The
// padding only rides in the API call — the canonical `input.text` used for
// storage/STT is untouched, and an edge space adds at most a hair of silence.
const MAX_EMPTY_RETRIES = 2;

/** Randomly pad a space on the front and/or end (50% chance each) to perturb a
 * request that came back empty. */
function padRandomSpaces(text: string): string {
  const front = Math.random() < 0.5 ? ' ' : '';
  const end = Math.random() < 0.5 ? ' ' : '';
  return `${front}${text}${end}`;
}

export const geminiTts: TTSProvider = {
  id: 'gemini',
  async speak(input: SpeakInput): Promise<SpeakResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

    const { voiceName, locale } = parseVoiceApiCode(input.voiceApiCode);
    // Accent locale comes from the voice apiCode suffix when present (English
    // US/GB/AU); otherwise derive it from the language code.
    const languageCode = locale ?? toGeminiBcp47(input.language);
    // Name of the target language for the "## Instruction" block so Gemini locks
    // pronunciation to it. Normally the region-stripped base name ("English
    // (US)" → "English") since the accent is already pinned by `language_code`
    // above. But some dialects can't be pinned by the locale (e.g. Levantine
    // Arabic → `ar-001`, shared with MSA/Saudi/Iraqi), so they set an explicit
    // `ttsPromptName` ("Levantine Arabic") to name the dialect in the prose —
    // the only signal Gemini gets to distinguish it. Falls back to the raw code.
    const lang = getLanguageByCode(input.language);
    const languageName =
      lang?.ttsPromptName ??
      (lang?.name ?? input.language).replace(/\s*\([^)]*\)\s*$/, '');

    let pcm = new Uint8Array(0);
    for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
      // First attempt sends the sentence as-is; retries randomly pad edge spaces.
      const sentence = attempt === 0 ? input.text : padRandomSpaces(input.text);
      pcm = await requestGeminiPcm(apiKey, {
        input: buildStyledInput(sentence, languageName),
        voiceName,
        languageCode,
        speed: input.speed,
      });
      if (pcm.byteLength > 0) break;
      console.warn(
        `[geminiTts] empty audio for "${input.text.slice(0, 40)}" ` +
          `(attempt ${attempt + 1}/${MAX_EMPTY_RETRIES + 1})` +
          (attempt < MAX_EMPTY_RETRIES
            ? ' — retrying with random space padding'
            : ''),
      );
    }
    if (pcm.byteLength === 0) {
      throw new Error('No audio content returned from Gemini TTS API');
    }

    // Gemini intermittently appends a short, loud "hiccup" after the sentence,
    // separated by a silence gap (~10% of clips). Strip it on the raw PCM using
    // only the energy envelope — no STT/word-timings — before transcoding. No-op
    // for the ~90% of clips without one (returns the same bytes). See tailTrim.ts.
    const { pcm: cleaned, trimmed } = trimTailHiccup(pcm, PCM_SAMPLE_RATE);
    if (trimmed) {
      console.log(
        `[geminiTts] trimmed tail hiccup for "${input.text.slice(0, 40)}"`,
      );
    }

    // Gemini emits headerless PCM; transcode to MP3 so the stored Blob matches
    // the other providers' output (google/azure both label it 'audio/mp3') and
    // plays in the browser.
    return {
      audio: new Blob([pcmToMp3(cleaned)], { type: 'audio/mp3' }),
      provider: 'gemini',
    };
  },
};
