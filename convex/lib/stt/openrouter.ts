/**
 * Speech-to-text via OpenRouter's transcription endpoint, model
 * MAI-Transcribe-2. Used app-wide for STT.
 *
 * Endpoint: POST https://openrouter.ai/api/v1/audio/transcriptions
 *   (OpenAI-compatible multipart: file, model, response_format,
 *   timestamp_granularities[], language)
 *
 * Authoritative for: TTS validation roundtrip and word-timing backfill
 * (features/ttsProcessing.ts) and chat / writing voice input
 * (features/chat/transcribe.ts).
 *
 * What the 2026-09-04 live test established (see
 * .scratch/stt-mai-transcribe-2/findings.md):
 *   - `verbose_json` + `timestamp_granularities[]=word` returns per-word
 *     start/end in seconds, although OpenRouter's docs only promise that for
 *     OpenAI, Groq and Together. CJK comes back one entry per character.
 *   - `language` is a bare ISO-639-1 code, one at a time; regional tags are
 *     ignored. Omitting it auto-detects, and code-switched audio ("how do you
 *     say guten Morgen in Spanish") transcribes verbatim, so there is no
 *     mixed-language error to retry around.
 *   - WAV, MP3, FLAC and OGG/Opus upload fine; WebM and MP4 return 400.
 *   - `usage.cost` is the exact USD charge; `usage.seconds` is the audio
 *     length rounded up to whole seconds, which is what the charge is based
 *     on.
 *   - Serbian comes back in Latin script and Taiwanese Mandarin in
 *     Simplified characters whatever the hint. `./scriptNormalize` fixes
 *     both after the fact.
 */

import type { ActionCtx } from '../../_generated/server';
import { OPENROUTER_MODELS } from '../../config/aiModels';
import { requireEnv } from '../env';
import { MAX_RETRIES, isRetryableStatus, retryDelayMs } from '../httpRetry';
import { reserveRateLimitToken } from '../rateLimitReserve';
import {
  containerOfBlob,
  sttFilename,
  STT_REJECTED_CONTAINERS,
  type AudioContainer,
} from './audioContainer';
import { toSttLanguage } from './languages';

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions';

/**
 * Reserve a slot in the `openrouterStt` token bucket before an STT call.
 * Every caller passes `maxWaitMs`: interactive ones (chat voice) keep it
 * tight so a saturated bucket fast-fails into a user-facing "busy" error,
 * and background ones (TTS validation, word-timing backfill) cap it so a
 * saturated bucket throws instead of sleeping a workpool worker in-slot.
 */
export async function reserveSttSlot(
  ctx: ActionCtx,
  opts: { maxWaitMs?: number } = {},
): Promise<void> {
  await reserveRateLimitToken(ctx, 'openrouterStt', opts);
}

/** Word-level timing relative to the audio blob (seconds). */
export type WordTiming = { word: string; start: number; end: number };

export interface TranscriptionResult {
  text: string;
  wordTimings: WordTiming[];
  /** Audio length as measured by the provider. */
  audioDurationMs?: number;
  /** Whole seconds the provider billed (audio length rounded up). */
  billedSeconds?: number;
  /** Exact USD charge reported by OpenRouter for this call. */
  costUsd?: number;
  /** Language the model settled on (bare code), pinned or detected. */
  detectedLanguage?: string;
}

export interface TranscribeOptions {
  /**
   * Retries on 429 / 5xx. Defaults to 2 (three attempts). Interactive
   * callers pass 1 so a flaky upstream fails fast instead of holding the
   * user for the full backoff. Every attempt rides the one `openrouterStt`
   * token the caller reserved: a retry after a 429 honours `retry-after`,
   * which is the pacing the endpoint asked for, and the bucket still bounds
   * how many callers get in at all.
   */
  maxRetries?: number;
}

interface OpenRouterTranscription {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
  words?: unknown;
  usage?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Thrown before any upload when the blob is a container the provider
 * refuses (WebM, MP4). Callers with a user in front of them reject earlier
 * (`transcribe.ts`, before the quota spend); this guards every other path.
 */
export class SttRejectedContainerError extends Error {
  constructor(readonly container: AudioContainer) {
    super(
      `STT provider rejects ${container} audio; upload WAV, MP3, FLAC or OGG`,
    );
    this.name = 'SttRejectedContainerError';
  }
}

/**
 * Transcribe an audio Blob. Returns the text, word-level timestamps
 * (seconds), and the provider's own duration and cost figures.
 *
 * When `internalLanguageCode` is provided its bare code is sent as the
 * language hint (best accuracy; used when we know what the clip is, i.e.
 * TTS validation, backfill, and writing-mode voice input pinned to the
 * row's language). When omitted the model auto-detects, including
 * mid-utterance switches.
 */
export async function transcribeAudio(
  blob: Blob,
  internalLanguageCode?: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;

  const container = await containerOfBlob(blob);
  if (STT_REJECTED_CONTAINERS.has(container)) {
    throw new SttRejectedContainerError(container);
  }
  const filename = sttFilename(container, blob.type);

  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // A fresh body per attempt: a consumed multipart body can't be re-sent.
    const formData = new FormData();
    formData.append('model', OPENROUTER_MODELS.stt);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    if (internalLanguageCode) {
      formData.append('language', toSttLanguage(internalLanguageCode));
    }
    formData.append('file', blob, filename);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      lastError = `OpenRouter STT API error: ${response.status} - ${await response.text()}`;
      if (!isRetryableStatus(response.status)) throw new Error(lastError);
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs(response, attempt)),
        );
      }
      continue;
    }

    // The body is untrusted: every field is narrowed before use, and a
    // malformed `words` or `usage` degrades to "no timings" / "no cost"
    // rather than throwing away a transcript that did arrive.
    const raw: unknown = await response.json();
    const data: OpenRouterTranscription = isRecord(raw) ? raw : {};
    const text = typeof data.text === 'string' ? data.text : '';
    const wordTimings: WordTiming[] = [];
    for (const w of Array.isArray(data.words) ? data.words : []) {
      if (!isRecord(w)) continue;
      const start = finiteOrUndefined(w.start);
      const end = finiteOrUndefined(w.end);
      if (
        typeof w.word !== 'string' ||
        start === undefined ||
        end === undefined
      ) {
        continue;
      }
      wordTimings.push({ word: w.word, start, end });
    }
    const usage = isRecord(data.usage) ? data.usage : {};
    const duration = finiteOrUndefined(data.duration);
    return {
      text,
      wordTimings,
      audioDurationMs:
        duration === undefined ? undefined : Math.round(duration * 1000),
      billedSeconds: finiteOrUndefined(usage.seconds),
      costUsd: finiteOrUndefined(usage.cost),
      detectedLanguage:
        typeof data.language === 'string' ? data.language : undefined,
    };
  }
  throw new Error(lastError);
}
