/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  transcribeAudio,
  AzureMultipleLanguagesError,
} from '../../../lib/stt/azure';

/**
 * The Azure Fast Transcription wire contract: which `locales` list goes out
 * for each calling mode, how a refusal of mixed-language audio is classified
 * (the recovery in features/chat/transcribe.ts keys on the error class), and
 * how the response maps to text + word timings.
 */

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response;
}

function okResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/** The `definition` JSON Azure receives in the multipart body of call N. */
function definitionOf(call: unknown[]): { locales: string[] } {
  const form = (call[1] as RequestInit).body as FormData;
  return JSON.parse(form.get('definition') as string);
}

const MIXED_422 = JSON.stringify({
  error: {
    code: 'InvalidRequest',
    innerError: { code: 'MultipleLanguagesIdentified' },
  },
});

const blob = () => new Blob([new Uint8Array(4)], { type: 'audio/webm' });

describe('lib/stt/azure transcribeAudio', () => {
  const originalKey = process.env.AZURE_SPEECH_API_KEY;
  const originalRegion = process.env.AZURE_SPEECH_REGION;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.AZURE_SPEECH_API_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'westeurope';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.AZURE_SPEECH_API_KEY = originalKey;
    process.env.AZURE_SPEECH_REGION = originalRegion;
  });

  it('classifies a 422 MultipleLanguagesIdentified as the recoverable error', async () => {
    fetchMock.mockResolvedValue(errorResponse(422, MIXED_422));
    await expect(
      transcribeAudio(blob(), undefined, {
        autoDetectCourseLanguages: ['en', 'sv'],
      }),
    ).rejects.toBeInstanceOf(AzureMultipleLanguagesError);
  });

  it('leaves every other failure as a plain Error', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(422, '{"error":{"code":"InvalidAudio"}}'),
    );
    const other422 = transcribeAudio(blob(), 'sv');
    await expect(other422).rejects.toThrow('Azure STT API error: 422');
    await expect(other422).rejects.not.toBeInstanceOf(
      AzureMultipleLanguagesError,
    );

    fetchMock.mockResolvedValueOnce(errorResponse(500, MIXED_422));
    await expect(transcribeAudio(blob(), 'sv')).rejects.not.toBeInstanceOf(
      AzureMultipleLanguagesError,
    );
  });

  it('asks for the multi-lingual model with an empty locale list when forced', async () => {
    fetchMock.mockResolvedValue(okResponse({ combinedPhrases: [] }));
    await transcribeAudio(blob(), undefined, { forceMultilingualModel: true });
    expect(definitionOf(fetchMock.mock.calls[0]).locales).toEqual([]);
  });

  it('pins a mixed-dialect code to both of its locales, a variant to one', async () => {
    fetchMock.mockResolvedValue(okResponse({ combinedPhrases: [] }));
    await transcribeAudio(blob(), 'es_mixed');
    expect(definitionOf(fetchMock.mock.calls[0]).locales).toEqual([
      'es-ES',
      'es-MX',
    ]);

    await transcribeAudio(blob(), 'es_mixed', { regionVariant: 'es-MX' });
    expect(definitionOf(fetchMock.mock.calls[1]).locales).toEqual(['es-MX']);

    // The force flag is documented as ignored once a language is pinned.
    await transcribeAudio(blob(), 'sv', { forceMultilingualModel: true });
    expect(definitionOf(fetchMock.mock.calls[2]).locales).toEqual(['sv-SE']);
  });

  it('maps the response to text, second-based word timings and the billed duration', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        durationMilliseconds: 1850,
        combinedPhrases: [{ text: 'hej hello' }],
        phrases: [
          {
            offsetMilliseconds: 0,
            durationMilliseconds: 1850,
            text: 'hej hello',
            locale: 'sv-SE',
            words: [
              {
                text: 'hej',
                offsetMilliseconds: 100,
                durationMilliseconds: 400,
              },
              {
                text: 'hello',
                offsetMilliseconds: 700,
                durationMilliseconds: 500,
              },
              // Malformed entries are skipped, not turned into NaN timings.
              {
                text: 'ghost',
                offsetMilliseconds: 'x',
                durationMilliseconds: 1,
              },
            ],
          },
        ],
      }),
    );
    const result = await transcribeAudio(blob(), 'sv');
    expect(result).toEqual({
      text: 'hej hello',
      audioDurationMs: 1850,
      wordTimings: [
        { word: 'hej', start: 0.1, end: 0.5 },
        { word: 'hello', start: 0.7, end: 1.2 },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://westeurope.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15',
    );
    expect(
      (init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key'],
    ).toBe('test-key');
  });
});
