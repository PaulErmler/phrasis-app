/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpeakInput } from '../../../lib/tts/types';
import { minimaxTts } from '../../../lib/tts/minimax';

const INPUT: SpeakInput = {
  text: '你好',
  language: 'yue',
  voiceApiCode: 'Cantonese_ProfessionalHost（F)',
  speed: 1,
};

/** Bytes that pass the MP3 frame-sync sniff. */
const MP3_BYTES = new Uint8Array([0xff, 0xf3, 0x00, 0x00]);

function response(
  body: Uint8Array,
  generationId: string | null = 'gen-1',
): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(
      generationId ? { 'x-generation-id': generationId } : {},
    ),
    arrayBuffer: async () => body.buffer,
    text: async () => '',
  } as unknown as Response;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  // Don't wait out the backoff between attempts.
  vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('minimaxTts.speak', () => {
  it('returns the generation id of the successful request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(MP3_BYTES)));

    const result = await minimaxTts.speak(INPUT);

    expect(result.provider).toBe('minimax');
    expect(result.generationIds).toEqual(['gen-1']);
  });

  it('keeps the id of a 200 whose body was not MP3 — it billed anyway', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(new Uint8Array([1, 2, 3, 4]), 'gen-junk'))
      .mockResolvedValueOnce(response(MP3_BYTES, 'gen-ok'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await minimaxTts.speak(INPUT);

    // Pricing only 'gen-ok' would halve the clip's real cost.
    expect(result.generationIds).toEqual(['gen-junk', 'gen-ok']);
  });

  it('returns no ids when the header is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(MP3_BYTES, null)),
    );

    expect((await minimaxTts.speak(INPUT)).generationIds).toEqual([]);
  });

  it('does not record a charge for a non-2xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'x-generation-id': 'gen-429' }),
        text: async () => 'rate limited',
      } as unknown as Response)
      .mockResolvedValueOnce(response(MP3_BYTES, 'gen-ok'));
    vi.stubGlobal('fetch', fetchMock);

    // OpenRouter does not bill a failed generation, so only the 200 counts.
    expect((await minimaxTts.speak(INPUT)).generationIds).toEqual(['gen-ok']);
  });
});
