/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpeakInput } from '../../../lib/tts/types';

// Stub the pure-JS MP3 encoder: these tests exercise the empty-response retry
// logic, not the transcode (which is verified separately end-to-end). The stub
// just returns a minimal valid-looking frame so `speak` can build its Blob.
vi.mock('@breezystack/lamejs', () => ({
  Mp3Encoder: class {
    encodeBuffer() {
      return new Uint8Array(0);
    }
    flush() {
      return new Uint8Array([0xff, 0xf3, 0x00, 0x00]);
    }
  },
}));

import { geminiTts } from '../../../lib/tts/gemini';

const INPUT: SpeakInput = {
  text: 'Guten Morgen!',
  language: 'de',
  voiceApiCode: 'Kore',
  speed: 1,
};

/** A 200 response carrying `byteLength` bytes of PCM. */
function pcmResponse(byteLength: number): Response {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(byteLength),
    text: async () => '',
  } as unknown as Response;
}

/** A 200 response with an empty body. The intermittent Gemini quirk. */
function emptyResponse(): Response {
  return pcmResponse(0);
}

/** Parse the JSON request body of the Nth fetch call. */
function bodyOf(call: unknown[]): {
  input: string;
  provider: { options: { google: { language_code: string; prompt?: string } } };
} {
  return JSON.parse((call[1] as RequestInit).body as string);
}

/** The spoken sentence. Everything after the "## Transcript: " marker. The
 * style instruction (Strategy C) rides ahead of it in a "## Context:" block. */
function transcriptOf(call: unknown[]): string {
  return bodyOf(call).input.split('## Transcript: ')[1];
}

describe('geminiTts.speak: empty-response retry', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.OPENROUTER_API_KEY = originalKey;
  });

  it('returns audio without retrying when the first response has audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pcmResponse(4096));
    vi.stubGlobal('fetch', fetchMock);

    const result = await geminiTts.speak(INPUT);

    expect(result.provider).toBe('gemini');
    expect(result.audio.type).toBe('audio/mp3');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transcriptOf(fetchMock.mock.calls[0])).toBe('Guten Morgen!');
  });

  it('wraps the sentence in a ## Context / ## Transcript block naming the language, with no prompt field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pcmResponse(4096));
    vi.stubGlobal('fetch', fetchMock);

    await geminiTts.speak(INPUT);

    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.input).toMatch(/^## Instruction:/);
    expect(body.input).toContain('German'); // getLanguageByCode('de').name
    expect(body.input).toContain('## Transcript: Guten Morgen!');
    // Strategy C: the style rides in `input`, so no prompt field is sent.
    expect(body.provider.options.google.prompt).toBeUndefined();
    expect(body.provider.options.google.language_code).toBe('de-DE');
  });

  it('names the Levantine dialect in the prompt while using the global Arabic Gemini voice + ar-001 locale', async () => {
    // Levantine has no dedicated Gemini locale (collapses to ar-001), so the
    // dialect can only be conveyed in the prose via `ttsPromptName`, and the
    // voice is the shared/global Arabic Gemini voice (a bare GEMINI_CORE name).
    const fetchMock = vi.fn().mockResolvedValue(pcmResponse(4096));
    vi.stubGlobal('fetch', fetchMock);

    await geminiTts.speak({
      text: 'كيفك؟',
      language: 'ar_lev',
      voiceApiCode: 'Leda', // bare GEMINI_CORE name (no @locale suffix)
      speed: 1,
    });

    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.input).toContain('Levantine Arabic'); // dialect named in prompt
    expect(body.input).not.toMatch(/native Arabic\b/); // NOT the stripped base name
    expect(body.input).toContain('## Transcript: كيفك؟');
    // Global Arabic Gemini voice, steered by the shared World-Arabic locale.
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        .voice,
    ).toBe('Leda');
    expect(body.provider.options.google.language_code).toBe('ar-001');
  });

  it('rejects a voice apiCode with a trailing "@" and no locale', async () => {
    // "Kore@" would otherwise yield an empty language_code and hard-400.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      geminiTts.speak({ ...INPUT, voiceApiCode: 'Kore@' }),
    ).rejects.toThrow('missing locale after "@"');
    // Failed before any network call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries with a padded space when the first response is empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(pcmResponse(4096));
    vi.stubGlobal('fetch', fetchMock);
    // Retry coin flips: front space (0.1 < 0.5), no end space (0.9 ≥ 0.5).
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);

    const result = await geminiTts.speak(INPUT);

    expect(result.provider).toBe('gemini');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First attempt sends the text as-is; the retry pads per the coin flips.
    expect(transcriptOf(fetchMock.mock.calls[0])).toBe('Guten Morgen!');
    expect(transcriptOf(fetchMock.mock.calls[1])).toBe(' Guten Morgen!');
  });

  it('pads front and/or end independently (50% each) on retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(pcmResponse(4096));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random')
      // attempt 1: front only. Front 0.1 (<0.5), end 0.9 (≥0.5)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      // attempt 2: end only. Front 0.9 (≥0.5), end 0.1 (<0.5)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1);

    await geminiTts.speak(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(transcriptOf(fetchMock.mock.calls[0])).toBe('Guten Morgen!');
    expect(transcriptOf(fetchMock.mock.calls[1])).toBe(' Guten Morgen!');
    expect(transcriptOf(fetchMock.mock.calls[2])).toBe('Guten Morgen! ');
  });

  it('keeps padding each attempt, then gives up after the cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal('fetch', fetchMock);
    // Every coin flip is heads → both edges padded on each retry.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    await expect(geminiTts.speak(INPUT)).rejects.toThrow(
      'No audio content returned from Gemini TTS API',
    );
    // original + 2 retries (MAX_EMPTY_RETRIES = 2)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(transcriptOf(fetchMock.mock.calls[0])).toBe('Guten Morgen!');
    expect(transcriptOf(fetchMock.mock.calls[1])).toBe(' Guten Morgen! ');
    expect(transcriptOf(fetchMock.mock.calls[2])).toBe(' Guten Morgen! ');
  });

  it('still surfaces a non-2xx error without entering the empty-retry path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => 'rate limited',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(geminiTts.speak(INPUT)).rejects.toThrow(
      'Gemini TTS API error: 429 - rate limited',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
