/**
 * Text-only speech-to-text through Gemini 3.1 Flash Lite on OpenRouter's
 * chat completions endpoint, for languages MAI-Transcribe-2 does not cover
 * (`sttBackend: 'gemini-flash-lite'` in lib/languages.ts; Uzbek as of Sep
 * 2026). The clip rides in the message as `input_audio`; the model answers
 * with the transcript alone.
 *
 * What the 2026-09-05 probe established (.scratch/uzbek/findings.md):
 *   - MAI returns 400 for a pinned `uz` and garbles auto-detected Uzbek;
 *     Flash Lite transcribed the same clips verbatim, modifier letters
 *     included, at $0.00012–0.00018 per 6–8 s sentence.
 *   - No word timestamps. Karaoke and the timing backfill stay off for
 *     languages routed here (`languageSupportsWordTimings`).
 *   - `usage.cost` is the exact USD charge when usage accounting is on.
 */

import {
  getLanguageByCode,
  getTranslationConfigForLanguage,
} from '../../../lib/languages';
import { OPENROUTER_MODELS } from '../../config/aiModels';
import { requireEnv } from '../env';
import { stripJsonFences } from '../llmJson';
import { MAX_RETRIES, isRetryableStatus, retryDelayMs } from '../httpRetry';
import {
  containerOfBuffer,
  isSttContainer,
  STT_REJECTED_CONTAINERS,
  type AudioContainer,
} from './audioContainer';
import { toSttLanguage } from './languages';
import {
  SttRejectedContainerError,
  type TranscribeOptions,
  type TranscriptionResult,
  isRecord,
} from './openrouter';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Enough for any sentence the pipeline synthesizes; the reply is the transcript only. */
const MAX_OUTPUT_TOKENS = 1_000;

/** OpenRouter's `input_audio.format` for a detected container; MP3 when the
 * bytes don't say (every clip the pipeline synthesizes is MP3). */
function inputAudioFormat(container: AudioContainer): string {
  return isSttContainer(container) ? container : 'mp3';
}

/** Base64 without Node's Buffer (the Convex runtime has `btoa` only). Chunked
 * so `String.fromCharCode` never sees an argument list the size of a clip. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The instruction that pins the language and script. `translationName`
 * carries the script qualifier where it matters ("Uzbek (Latin script)"),
 * so the transcript comes back in the catalogue's script and the comparator
 * never sees a Cyrillic rendering of a Latin sentence.
 */
export function transcriptionPrompt(internalLanguageCode?: string): string {
  if (!internalLanguageCode) {
    return 'Transcribe this audio verbatim, in the language that is spoken. Output only the transcript: no commentary, no quotation marks, no translation.';
  }
  const lang = getLanguageByCode(internalLanguageCode);
  const name = lang
    ? getTranslationConfigForLanguage(internalLanguageCode).targetLangName
    : internalLanguageCode;
  return `Transcribe this ${name} audio verbatim, in ${name} with standard spelling and punctuation. Output only the transcript: no commentary, no quotation marks, no translation.`;
}

interface ChatCompletion {
  choices?: unknown;
  usage?: unknown;
}

/** Content of the first choice, or '' when the body has none. */
function transcriptOf(raw: unknown): string {
  const data: ChatCompletion = isRecord(raw) ? raw : {};
  const first = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message =
    isRecord(first) && isRecord(first.message) ? first.message : {};
  const content = message.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              isRecord(part) && typeof part.text === 'string' ? part.text : '',
            )
            .join('')
        : '';
  // Models occasionally wrap the transcript in quotes or a code fence
  // despite the instruction; both are never part of what was said. The
  // quote pair is only stripped when nothing inside is quoted, so a
  // transcript with two quoted spans keeps both.
  return stripJsonFences(text.trim())
    .replace(/^["“„'‘]([^"“”„'‘’]*)["”'’]$/u, '$1')
    .trim();
}

/**
 * Transcribe an audio Blob with Gemini. Same contract as the MAI backend
 * (`transcribeAudio` in ./openrouter.ts) minus timings: `wordTimings` is
 * always empty and no duration is reported, so the cost event falls back to
 * `costUsd` alone. Throws on a non-retryable HTTP error, after the retries
 * on 429 / 5xx, or when the model returns no transcript.
 */
export async function transcribeAudioWithGemini(
  blob: Blob,
  internalLanguageCode?: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;

  // A blob from `ctx.storage.get` streams and can be read once, so the
  // bytes are read once and both the sniff and the payload use them.
  const bytes = await blob.arrayBuffer();
  const container = containerOfBuffer(bytes);
  if (STT_REJECTED_CONTAINERS.has(container)) {
    throw new SttRejectedContainerError(container);
  }
  const data = bytesToBase64(new Uint8Array(bytes));
  const body = JSON.stringify({
    model: OPENROUTER_MODELS.sttGemini,
    usage: { include: true },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: transcriptionPrompt(internalLanguageCode) },
          {
            type: 'input_audio',
            input_audio: { data, format: inputAudioFormat(container) },
          },
        ],
      },
    ],
  });

  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      lastError = `OpenRouter Gemini STT API error: ${response.status} - ${await response.text()}`;
      if (!isRetryableStatus(response.status)) throw new Error(lastError);
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs(response, attempt)),
        );
      }
      continue;
    }

    const raw: unknown = await response.json();
    const text = transcriptOf(raw);
    if (!text) {
      throw new Error('OpenRouter Gemini STT returned no transcript');
    }
    const usage = isRecord(raw) && isRecord(raw.usage) ? raw.usage : {};
    return {
      text,
      wordTimings: [],
      costUsd:
        typeof usage.cost === 'number' && Number.isFinite(usage.cost)
          ? usage.cost
          : undefined,
      detectedLanguage: internalLanguageCode
        ? toSttLanguage(internalLanguageCode)
        : undefined,
    };
  }
  throw new Error(lastError);
}
