import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AUTUMN_API,
  autumnFetch,
  autumnFetchRaw,
} from '../../usage/autumnClient';

/**
 * Direct tests for the shared Autumn REST wrapper. Every hand-rolled
 * billing call (billing.ts, autumn.ts, usage/testing.ts) goes through it,
 * so a regression here corrupts every money path at once. Pins the wire
 * shape (headers, per-call version, body handling) and the two error
 * policies: raw never throws on HTTP errors, the typed wrapper always does
 * (except an explicitly allowed 404).
 */

type FetchArgs = { url: string; init: RequestInit };
let seen: FetchArgs[] = [];

function stubFetch(status: number, body: string) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return {
      ok: status < 400,
      status,
      text: async () => body,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  seen = [];
  vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_stub');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('autumnFetchRaw', () => {
  it('sends auth, content-type, and the PER-CALL api version verbatim', async () => {
    stubFetch(200, '{}');
    await autumnFetchRaw(
      'POST',
      '/billing.attach',
      { plan_id: 'pro' },
      '2.1.0',
    );
    expect(seen[0].url).toBe(`${AUTUMN_API}/billing.attach`);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer am_sk_test_stub');
    expect(headers['x-api-version']).toBe('2.1.0');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ plan_id: 'pro' });
  });

  it('omits the body entirely for undefined (GETs must not send one)', async () => {
    stubFetch(200, '{}');
    await autumnFetchRaw('GET', '/customers/u1', undefined, '1.2');
    expect('body' in seen[0].init).toBe(false);
  });

  it('never throws on HTTP errors, callers own the policy', async () => {
    stubFetch(500, '{"message":"boom"}');
    const res = await autumnFetchRaw('GET', '/customers/u1', undefined, '1.2');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ message: 'boom' });
  });

  it('falls back to the raw text when the body is not JSON', async () => {
    stubFetch(200, 'plain text');
    const res = await autumnFetchRaw('GET', '/customers/u1', undefined, '1.2');
    expect(res.json).toBe('plain text');
    expect(res.text).toBe('plain text');
  });
});

describe('autumnFetch', () => {
  it('returns the parsed body on success', async () => {
    stubFetch(200, '{"payment_url":"https://x"}');
    const body = await autumnFetch<{ payment_url: string }>(
      'POST',
      '/billing.attach',
      {},
      '2.1.0',
    );
    expect(body).toEqual({ payment_url: 'https://x' });
  });

  it("throws with Autumn's message on any non-2xx (after logging)", async () => {
    stubFetch(400, '{"message":"customize.free_trial invalid"}');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        autumnFetch('POST', '/billing.attach', {}, '2.1.0'),
      ).rejects.toThrow(/customize\.free_trial invalid/);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('404 throws by default, a missing resource is not silently null', async () => {
    stubFetch(404, '{"message":"not found"}');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        autumnFetch('GET', '/customers/u1', undefined, '1.2'),
      ).rejects.toThrow(/not found/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("404 returns null with nullOn404, the 'customer not created yet' reading", async () => {
    stubFetch(404, '{"message":"not found"}');
    const body = await autumnFetch(
      'GET',
      '/customers/u1?expand=trials_used',
      undefined,
      '1.2',
      { nullOn404: true },
    );
    expect(body).toBeNull();
  });
});
