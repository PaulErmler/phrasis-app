/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: vi.fn(),
}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => (modelSlug: string) => ({ modelId: modelSlug }),
}));

import { APICallError, generateText } from 'ai';
import {
  isTransientLlmFailure,
  romanizeText,
} from '../../features/translation';
import { TransientAnnotationError } from '../../lib/textAnnotations';

function apiError(statusCode: number | undefined, isRetryable = false) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

function reply(text: string) {
  vi.mocked(generateText).mockResolvedValueOnce({
    text,
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
