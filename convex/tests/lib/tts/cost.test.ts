/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthCostForEvent, synthesisFailureCost } from '../../../lib/tts/cost';
import { TtsSynthesisFailedError } from '../../../lib/tts/types';

const mocks = vi.hoisted(() => ({ generationCostUsd: vi.fn() }));
vi.mock('../../../lib/openrouterGeneration', () => ({
  generationCostUsd: mocks.generationCostUsd,
}));

beforeEach(() => {
  // The real function always resolves to an object, never undefined.
  mocks.generationCostUsd
    .mockReset()
    .mockResolvedValue({ costUsd: undefined, pricedIds: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('synthCostForEvent', () => {
  it('prices Google from the published per-character rate, no lookup', async () => {
    const cost = await synthCostForEvent({
      provider: 'google',
      characterCount: 1_000_000,
      generationIds: [],
    });

    expect(cost).toEqual({
      costUsd: 30,
      source: 'rate_table',
      billedRequests: 1,
      pricedRequests: 1,
    });
    expect(mocks.generationCostUsd).not.toHaveBeenCalled();
  });

  it('prices an OpenRouter clip from the exact billed figure', async () => {
    mocks.generationCostUsd.mockResolvedValue({
      costUsd: 0.0031,
      pricedIds: 1,
    });

    const cost = await synthCostForEvent({
      provider: 'gemini',
      characterCount: 42,
      generationIds: ['gen-a'],
    });

    expect(cost).toEqual({
      costUsd: 0.0031,
      source: 'generation_api',
      billedRequests: 1,
      pricedRequests: 1,
    });
  });

  it('counts every billed request, so a retried clip is not priced as one', async () => {
    mocks.generationCostUsd.mockResolvedValue({
      costUsd: 0.006,
      pricedIds: 3,
    });

    const cost = await synthCostForEvent({
      provider: 'gemini',
      characterCount: 42,
      // Two empty 200s then a good one. All three billed.
      generationIds: ['gen-a', 'gen-b', 'gen-c'],
    });

    expect(cost.billedRequests).toBe(3);
    expect(cost.source).toBe('generation_api');
  });

  it('flags a sum that is missing some of its requests', async () => {
    mocks.generationCostUsd.mockResolvedValue({
      costUsd: 0.002,
      pricedIds: 1,
    });

    const cost = await synthCostForEvent({
      provider: 'minimax',
      characterCount: 42,
      generationIds: ['gen-a', 'gen-b'],
    });

    expect(cost.source).toBe('generation_api_partial');
    expect(cost.pricedRequests).toBe(1);
    expect(cost.billedRequests).toBe(2);
  });

  it('reports unavailable rather than zero when nothing priced', async () => {
    mocks.generationCostUsd.mockResolvedValue({
      costUsd: undefined,
      pricedIds: 0,
    });

    const cost = await synthCostForEvent({
      provider: 'gemini',
      characterCount: 42,
      generationIds: ['gen-a'],
    });

    // A zero would read as a free call, which is how synthesis spend went
    // missing in the first place.
    expect(cost.costUsd).toBeUndefined();
    expect(cost.source).toBe('unavailable');
  });
});

describe('synthesisFailureCost', () => {
  it('prices the attempts a failed synthesis already billed', async () => {
    mocks.generationCostUsd.mockResolvedValue({
      costUsd: 0.0045,
      pricedIds: 3,
    });

    const err = new TtsSynthesisFailedError('gave up', [
      'gen-a',
      'gen-b',
      'gen-c',
    ]);

    // Three billed requests and no audio is the most expensive outcome there
    // is; reporting nothing for it would hide the worst case.
    expect(await synthesisFailureCost('gemini', err)).toEqual({
      costUsd: 0.0045,
    });
  });

  it('reports nothing for an error that carries no billed ids', async () => {
    expect(
      await synthesisFailureCost('gemini', new Error('network down')),
    ).toEqual({});
    expect(mocks.generationCostUsd).toHaveBeenCalledWith([]);
  });

  it('never prices a failed Google synthesis from the character rate', async () => {
    // Google bills for a request that returned audio, so a failure is free.
    expect(await synthesisFailureCost('google', new Error('boom'))).toEqual({});
    expect(mocks.generationCostUsd).not.toHaveBeenCalled();
  });
});
