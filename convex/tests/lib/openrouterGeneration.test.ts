/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generationCostUsd } from '../../lib/openrouterGeneration';

/** A stats-endpoint 200 reporting `totalCost`. */
function costResponse(totalCost: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ data: { total_cost: totalCost } }),
  } as unknown as Response;
}

/** A non-2xx from the stats endpoint. 404 is "the row hasn't landed yet". */
function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  // The backoff between lookup attempts must not make the suite wait.
  vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as unknown as typeof setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('generationCostUsd', () => {
  it('sums every id, because one clip can be several billed requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(costResponse(0.0004))
      .mockResolvedValueOnce(costResponse(0.0002));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generationCostUsd(['gen-a', 'gen-b']);

    expect(result.costUsd).toBeCloseTo(0.0006, 10);
    expect(result.pricedIds).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 404 — the stats row lands a moment after the response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(costResponse(0.0009));
    vi.stubGlobal('fetch', fetchMock);

    expect(await generationCostUsd(['gen-a'])).toEqual({
      costUsd: 0.0009,
      pricedIds: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a partial sum as partial, so it cannot read as cheap', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(costResponse(0.0004))
      .mockResolvedValue(errorResponse(404));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generationCostUsd(['gen-a', 'gen-b']);

    expect(result.costUsd).toBe(0.0004);
    // Below the id count: the caller flags this as `generation_api_partial`.
    expect(result.pricedIds).toBe(1);
  });

  it('gives up on a 4xx that is not a missing row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    expect(await generationCostUsd(['gen-a'])).toEqual({
      costUsd: undefined,
      pricedIds: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws: a network failure is an unpriced id, not a failed clip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('socket hang up')),
    );

    expect(await generationCostUsd(['gen-a'])).toEqual({
      costUsd: undefined,
      pricedIds: 0,
    });
  });

  it('reports undefined rather than 0 when nothing priced', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(costResponse('nope')));

    // A zero here would read as a free call on the dashboard.
    expect(await generationCostUsd(['gen-a'])).toEqual({
      costUsd: undefined,
      pricedIds: 0,
    });
  });

  it('makes no request at all when the provider yielded no ids (Google)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await generationCostUsd([])).toEqual({
      costUsd: undefined,
      pricedIds: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the lookup when no API key is configured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await generationCostUsd(['gen-a'])).toEqual({
      costUsd: undefined,
      pricedIds: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
