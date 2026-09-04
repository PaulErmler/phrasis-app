/**
 * OpenRouter `/audio/transcriptions` response fixtures for suites that drive
 * the content pipeline through a stubbed `fetch`. One place for the
 * verbose_json shape so the four suites that mock STT can't drift apart.
 */

export const OPENROUTER_STT_URL_FRAGMENT = '/audio/transcriptions';

/** True for the OpenRouter transcription endpoint (and nothing else we call). */
export function isOpenrouterSttUrl(url: string): boolean {
  return url.includes(OPENROUTER_STT_URL_FRAGMENT);
}

/** Leading bytes of each container, enough for `detectAudioContainer`. */
export const WAV_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74,
  0x20,
]);
export const WEBM_HEADER = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81,
]);
export const MP4_HEADER = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
export const ID3_HEADER = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]);

export type FixtureWord = { word: string; start: number; end: number };

/**
 * A verbose_json body. Defaults to one word spanning half a second, billed
 * as one second at the $0.10/h list price, detected as Spanish.
 */
export function openrouterSttBody(
  text: string,
  opts: {
    words?: FixtureWord[];
    duration?: number;
    seconds?: number;
    cost?: number;
    language?: string;
  } = {},
): string {
  const duration = opts.duration ?? 0.5;
  const words =
    opts.words ?? (text ? [{ word: text, start: 0, end: duration }] : []);
  const seconds = opts.seconds ?? Math.ceil(duration);
  return JSON.stringify({
    task: 'transcribe',
    text,
    language: opts.language ?? 'es',
    duration,
    segments: text ? [{ id: 0, start: 0, end: duration, text }] : [],
    words,
    usage: {
      seconds,
      cost: opts.cost ?? (seconds / 3600) * 0.1,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
  });
}
