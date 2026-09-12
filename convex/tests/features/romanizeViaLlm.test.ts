/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: vi.fn(),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => (modelSlug: string) => ({ modelId: modelSlug }),
}));
vi.mock('../../lib/posthogAi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/posthogAi')>()),
  captureGeneration: vi.fn(),
}));

import { APICallError, generateText } from 'ai';
import {
  isTransientLlmFailure,
  romanizeText,
} from '../../features/translation';
import { TransientAnnotationError } from '../../lib/textAnnotations';
import { captureGeneration } from '../../lib/posthogAi';

const mockCapture = vi.mocked(captureGeneration);
/** A no-op scheduler ctx: `captureGeneration` is mocked, so it is never used. */
const telemetry = { ctx: { scheduler: {} } as never };

function apiError(statusCode: number | undefined, isRetryable = false) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

function reply(text: string, costUsd = 0.00004, generationId = 'gen-rom') {
  vi.mocked(generateText).mockResolvedValueOnce({
    text,
    usage: { inputTokens: 12, outputTokens: 8 },
    providerMetadata: {
      openrouter: { id: generationId, usage: { cost: costUsd } },
    },
  } as unknown as Awaited<ReturnType<typeof generateText>>);
}

/**
 * The model path's failure contract, which is what decides whether a Thai or
 * Hebrew row is retried on the next view (TransientAnnotationError) or takes
 * the permanent '' sentinel (plain Error). The Google path has the same
 * split in translation.test.ts.
 */
describe('romanizeViaLlm (Thai / Hebrew through the model)', () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    mockCapture.mockReset().mockResolvedValue(undefined);
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the parsed romanization', async () => {
    reply('{"romanization": "sawatdi khrap"}');
    expect(await romanizeText('สวัสดีครับ', 'th')).toBe('sawatdi khrap');
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('reports the billed cost of the call', async () => {
    reply('{"romanization": "sawatdi khrap"}', 0.00004, 'gen-th');

    await romanizeText('สวัสดีครับ', 'th', telemetry);

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({
      feature: 'romanization',
      provider: 'openrouter',
      costUsd: 0.00004,
      traceId: 'gen-th',
      sharedContent: true,
      extra: { language: 'th', attempt: 1 },
    });
  });

  it('reports every attempt, because an unusable reply was billed too', async () => {
    reply('nonsense', 0.00003, 'gen-bad');
    reply('{"romanization": "shalom"}', 0.00005, 'gen-good');

    await romanizeText('שלום', 'he', telemetry);

    // Charging only for the reply we could use would under-report by a third.
    expect(mockCapture).toHaveBeenCalledTimes(2);
    expect(mockCapture.mock.calls.map((c) => c[1].costUsd)).toEqual([
      0.00003, 0.00005,
    ]);
    expect(mockCapture.mock.calls.map((c) => c[1].extra?.attempt)).toEqual([
      1, 2,
    ]);
  });

  it('reports nothing when the call never reached the model', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(apiError(401));

    await expect(romanizeText('שלום', 'he', telemetry)).rejects.toThrow();

    // A transport failure is not a charge.
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('recovers when a later reply parses', async () => {
    reply('nonsense');
    reply('{"romanization": "shalom"}');
    expect(await romanizeText('שלום', 'he')).toBe('shalom');
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('gives up on three unusable replies with a PERMANENT failure', async () => {
    // Temperature 0: the third unusable reply is a fact about the text, so
    // the runner may record the sentinel instead of re-buying it per view.
    reply('nonsense');
    reply('{"romanization": ""}');
    reply('{}');
    const err: unknown = await romanizeText('🙂', 'th').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TransientAnnotationError);
    expect((err as Error).message).toMatch(/Unparseable/);
    expect(generateText).toHaveBeenCalledTimes(3);
  });

  it('does not retry an API error itself: the SDK already did', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(apiError(503, true));
    await expect(romanizeText('שלום', 'he')).rejects.toBeInstanceOf(
      TransientAnnotationError,
    );
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('treats a deterministic 4xx as a fact about the request', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(apiError(400));
    const err: unknown = await romanizeText('שלום', 'he').catch((e) => e);
    expect(err).toBeInstanceOf(APICallError);
    expect(err).not.toBeInstanceOf(TransientAnnotationError);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('leaves the row open when the key is missing', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(romanizeText('שלום', 'he')).rejects.toBeInstanceOf(
      TransientAnnotationError,
    );
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('isTransientLlmFailure', () => {
  it.each([
    [429, true, true],
    [503, true, true],
    [401, false, true],
    [402, false, true],
    [403, false, true],
    [undefined, false, true],
    [400, false, false],
    [404, false, false],
    [422, false, false],
  ])(
    'status %s (retryable=%s) → transient=%s',
    (status, retryable, expected) => {
      expect(isTransientLlmFailure(apiError(status, retryable))).toBe(expected);
    },
  );

  it('treats a plain network error as transient', () => {
    expect(isTransientLlmFailure(new TypeError('fetch failed'))).toBe(true);
  });
});
