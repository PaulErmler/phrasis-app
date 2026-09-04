import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { transcribeAudio } from '../../../lib/stt/openrouter';
import { ID3_HEADER, WAV_HEADER, openrouterSttBody } from '../sttFixtures';

/**
 * The OpenRouter transcription wire contract: what goes into the multipart
 * body per calling mode, how the file is named from its bytes, how the
 * verbose_json response maps to text + word timings + cost, and which HTTP
 * failures are retried.
 */

function errorResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

function okResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formOf(call: unknown[]): FormData {
  return (call[1] as RequestInit).body as FormData;
}

const wavBlob = () => new Blob([WAV_HEADER], { type: 'audio/wav' });

describe('lib/stt/openrouter transcribeAudio', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it('sends the model, verbose_json, word granularity and the bare language hint', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(openrouterSttBody('hola')));

    await transcribeAudio(wavBlob(), 'es_mixed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect((init as RequestInit).headers).toEqual({
      Authorization: 'Bearer test-openrouter-key',
    });
    const form = formOf(fetchMock.mock.calls[0]);
    expect(form.get('model')).toBe('microsoft/mai-transcribe-2');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word']);
    // Regional variants collapse to the base code; the model takes nothing else.
    expect(form.get('language')).toBe('es');
    expect((form.get('file') as File).name).toBe('audio.wav');
  });

  it('omits the language field when nothing is pinned (auto-detect)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(openrouterSttBody('hola')));

    await transcribeAudio(wavBlob());

    expect(formOf(fetchMock.mock.calls[0]).has('language')).toBe(false);
  });

  it('names the upload from its bytes, then its mime label, then MP3', async () => {
    // A Response body reads once, so each call gets a fresh one.
    fetchMock.mockImplementation(async () =>
      okResponse(openrouterSttBody('x')),
    );

    await transcribeAudio(new Blob([ID3_HEADER], { type: 'audio/wav' }));
    await transcribeAudio(new Blob([new Uint8Array(8)], { type: 'audio/ogg' }));
    await transcribeAudio(new Blob([new Uint8Array(8)]));

    const names = fetchMock.mock.calls.map(
      (c) => (formOf(c).get('file') as File).name,
    );
    expect(names).toEqual(['audio.mp3', 'audio.ogg', 'audio.mp3']);
  });

  it('maps the verbose_json response to text, timings, duration and cost', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(
        JSON.stringify({
          text: 'Hola mundo',
          language: 'es',
          duration: 1.234,
          words: [
            { word: 'Hola', start: 0, end: 0.4 },
            { word: 'mundo', start: 0.5, end: 1.0 },
            // Malformed entries are skipped, not zero-filled.
            { word: 'x', start: 'soon' },
            { start: 1, end: 2 },
          ],
          usage: { seconds: 2, cost: 0.0000556 },
        }),
      ),
    );

    const result = await transcribeAudio(wavBlob(), 'es');

    expect(result).toEqual({
      text: 'Hola mundo',
      wordTimings: [
        { word: 'Hola', start: 0, end: 0.4 },
        { word: 'mundo', start: 0.5, end: 1.0 },
      ],
      audioDurationMs: 1234,
      billedSeconds: 2,
      costUsd: 0.0000556,
      detectedLanguage: 'es',
    });
  });

  it('degrades a malformed words or usage field to no timings / no cost', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(
        JSON.stringify({
          text: 'hola',
          words: 'nope',
          usage: 'free',
          duration: 1,
        }),
      ),
    );

    const result = await transcribeAudio(wavBlob());

    expect(result.text).toBe('hola');
    expect(result.wordTimings).toEqual([]);
    expect(result.costUsd).toBeUndefined();
    expect(result.billedSeconds).toBeUndefined();
    expect(result.audioDurationMs).toBe(1000);
  });

  it('tolerates a response with no words, duration or usage', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(JSON.stringify({ text: '' })));

    const result = await transcribeAudio(wavBlob());

    expect(result).toEqual({
      text: '',
      wordTimings: [],
      audioDurationMs: undefined,
      billedSeconds: undefined,
      costUsd: undefined,
      detectedLanguage: undefined,
    });
  });

  it('retries a 429 after its retry-after and succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        errorResponse(429, 'slow down', { 'retry-after': '1' }),
      )
      .mockResolvedValueOnce(okResponse(openrouterSttBody('hola')));

    const pending = transcribeAudio(wavBlob());
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.text).toBe('hola');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx up to maxRetries and then throws the last error', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => errorResponse(502, 'bad gateway'));

    const pending = transcribeAudio(wavBlob());
    // Attach the rejection handler before advancing so the fake-timer loop
    // doesn't see an unhandled rejection.
    const outcome = pending.then(
      () => 'resolved',
      (err: Error) => err.message,
    );
    await vi.runAllTimersAsync();

    expect(await outcome).toMatch(
      /OpenRouter STT API error: 502 - bad gateway/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honours maxRetries: 1 for interactive callers', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => errorResponse(503, 'unavailable'));

    const outcome = transcribeAudio(wavBlob(), undefined, {
      maxRetries: 1,
    }).then(
      () => 'resolved',
      (err: Error) => err.message,
    );
    await vi.runAllTimersAsync();

    expect(await outcome).toMatch(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, 'Provider returned 400'),
    );

    await expect(transcribeAudio(wavBlob())).rejects.toThrow(
      /OpenRouter STT API error: 400 - Provider returned 400/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
