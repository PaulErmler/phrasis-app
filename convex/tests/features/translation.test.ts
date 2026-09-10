/// <reference types="vite/client" />
import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { romanizeText } from '../../features/translation';
import { TransientAnnotationError } from '../../lib/textAnnotations';

/**
 * Stub Google auth plus the romanize endpoint; `romanize` answers each call
 * in turn (1-based). Returns the call counter.
 */
function stubGoogle(romanize: (call: number) => Response) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  vi.stubEnv(
    'GOOGLE_SERVICE_ACCOUNT_KEY',
    JSON.stringify({
      client_email: 'tester@example.iam.gserviceaccount.com',
      private_key: privateKey as unknown as string,
      project_id: 'test-project',
    }),
  );
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'fake-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('translation.googleapis.com')) {
        calls++;
        return romanize(calls);
      }
      throw new Error(`Unexpected fetch to ${u}`);
    }),
  );
  return { calls: () => calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// translation.ts exposes shared helpers (no Convex functions).
// Only the zh/el/ko paths are pure (local libs); the v2/v3 Google paths
// require network + credentials and are covered via integration tests.
describe('features/translation helpers', () => {
  describe('romanizeText', () => {
    it('romanizes Chinese with pinyin', async () => {
      const out = await romanizeText('你好', 'zh');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
      // pinyin for 你好 starts with "n" + some vowel (tone-marked or not)
      expect(out.toLowerCase()).toMatch(/^n/);
    });

    it('romanizes Greek with phonetic Latin mapping', async () => {
      const out = await romanizeText('Γειά', 'el');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    });

    it('romanizes Korean Hangul via Revised Romanization', async () => {
      const out = await romanizeText('안녕', 'ko');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    });

    it('romanizes Russian via Google v3', async () => {
      // Generate a real RSA keypair so `importPKCS8` + JWT signing succeed.
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const serviceAccount = {
        client_email: 'tester@example.iam.gserviceaccount.com',
        private_key: privateKey as unknown as string,
        project_id: 'test-project',
      };
      vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', JSON.stringify(serviceAccount));

      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('oauth2.googleapis.com')) {
          return new Response(JSON.stringify({ access_token: 'fake-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('translation.googleapis.com')) {
          return new Response(
            JSON.stringify({
              romanizations: [{ romanizedText: 'privet' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const out = await romanizeText('привет', 'ru');
        expect(out).toBe('privet');
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      expect(fetchMock).toHaveBeenCalled();
    });

    it('throws cleanly (without hitting the network) for languages outside GOOGLE_V3_ROMANIZE_SUPPORTED', async () => {
      // Polish has no local romanizer and is not in Google v3's supported list,
      // so romanizeText should throw via the hard gate before any HTTP call.
      // We stub fetch with a "must not be called" assertion so a regression
      // that bypassed the gate would surface as a clear failure.
      const fetchMock = vi.fn(async () => {
        throw new Error(
          'romanizeText hit the network for an unsupported language — the hard gate regressed',
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        await expect(romanizeText('dzień dobry', 'pl')).rejects.toThrow(
          /Romanization not configured/i,
        );
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('routes Arabic to Google v3, not to a local library', async () => {
      // Arabic returned to Google v3 in Sep 2026 (Paul's call). It had been
      // moved off after a production regression where the endpoint answered
      // `{"romanizations":[{}]}` for short Arabic strings — that is exactly
      // what ROMANIZE_MAX_ATTEMPTS was added for, and the retry loop is what
      // makes the route survivable now.
      //
      // `arabic-transliterate` is gone: it produced IJMES academic output
      // ("shkra jzyal-" for شكرا جزيلا), which scored 65% against
      // data_preparation/romanization_eval and is not a learner reading aid.
      const fetchMock = vi.fn(async () => {
        throw new Error('google call attempted');
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        await expect(romanizeText('مرحبا', 'ar')).rejects.toThrow();
      } finally {
        vi.unstubAllGlobals();
      }
      // The point of the test: it reached the network rather than answering
      // from a local library.
      expect(fetchMock).toHaveBeenCalled();
    });

    it('romanizes Telugu locally (no network call) because Google v3 400s on te', async () => {
      // Production: romanizeText v3 returns 400 "Source language is unsupported"
      // for `te` even though Google's docs still list it. Same trap as `fa`.
      const fetchMock = vi.fn(async () => {
        throw new Error(
          'romanizeText hit the network for Telugu — local path regressed',
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const out = await romanizeText('నమస్కారం', 'te');
        expect(out).toBe('namaskāraṁ');
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('romanizes Bulgarian locally (no network call) because Google v3 has no bg', async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error(
          'romanizeText hit the network for Bulgarian — local path regressed',
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const out = await romanizeText('България', 'bg');
        expect(out).toBe('Bulgaria');
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Arabic dialect codes (ar_sa / ar_eg / ar_iq / ar_lev) follow ar to Google v3', async () => {
      // The dialect tail collapses to `ar` via GOOGLE_TRANSLATE_CODE_MAP, so
      // all five codes must take the same route. A dialect left behind on a
      // different engine would romanize the same script two ways.
      const fetchMock = vi.fn(async () => {
        throw new Error('google call attempted');
      });
      vi.stubGlobal('fetch', fetchMock);
      try {
        for (const code of ['ar_sa', 'ar_eg', 'ar_iq', 'ar_lev'] as const) {
          await expect(romanizeText('هلو', code)).rejects.toThrow();
        }
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).toHaveBeenCalled();
    });

    it('Google v3 callers (Russian) get retried up to 3 times before failing', async () => {
      // The 3-retry wrapper applies to every language still routed through
      // Google v3. We exercise it with Russian since `ar` no longer reaches
      // this path. The mock returns `{romanizations:[{}]}` every time,
      // simulating the Google flake that prompted the retry, and we assert
      // the fetch was attempted exactly ROMANIZE_MAX_ATTEMPTS times before
      // the final throw.
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const serviceAccount = {
        client_email: 'tester@example.iam.gserviceaccount.com',
        private_key: privateKey as unknown as string,
        project_id: 'test-project',
      };
      vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', JSON.stringify(serviceAccount));

      let romanizeCalls = 0;
      let romanizeBody: unknown = null;
      const fetchMock = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const u = typeof url === 'string' ? url : url.toString();
          if (u.includes('oauth2.googleapis.com')) {
            return new Response(
              JSON.stringify({ access_token: 'fake-token' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (u.includes('translation.googleapis.com')) {
            romanizeCalls++;
            romanizeBody = init?.body ? JSON.parse(init.body as string) : null;
            // Always-empty response, same shape we saw from production.
            return new Response(JSON.stringify({ romanizations: [{}] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`Unexpected fetch to ${u}`);
        },
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await expect(romanizeText('привет', 'ru')).rejects.toThrow(
          /No romanization returned/i,
        );
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      expect(romanizeCalls).toBe(3);
      // Wire format guard. Keep on a still-Google-routed language now that
      // Arabic no longer covers it.
      expect(
        (romanizeBody as { source_language_code?: string } | null)
          ?.source_language_code,
      ).toBe('ru');
    });

    it('Google v3 succeeds on a later retry attempt (recovery path)', async () => {
      // The whole point of the retry: a transient empty response on attempt
      // 1 shouldn't doom the row. Mock returns empty once, then a real
      // romanization on attempt 2. The function should return the latter.
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const serviceAccount = {
        client_email: 'tester@example.iam.gserviceaccount.com',
        private_key: privateKey as unknown as string,
        project_id: 'test-project',
      };
      vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', JSON.stringify(serviceAccount));

      let romanizeCalls = 0;
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('oauth2.googleapis.com')) {
          return new Response(JSON.stringify({ access_token: 'fake-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('translation.googleapis.com')) {
          romanizeCalls++;
          if (romanizeCalls === 1) {
            return new Response(JSON.stringify({ romanizations: [{}] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({
              romanizations: [{ romanizedText: 'privet' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const out = await romanizeText('привет', 'ru');
        expect(out).toBe('privet');
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      expect(romanizeCalls).toBe(2);
    });

    it('an empty Google reply leaves the row open rather than taking the sentinel', async () => {
      // The Arabic flake: `{"romanizations":[{}]}` from one backend
      // instance while another answers. Not a fact about the text, so the
      // runners must not record the permanent '' for it.
      const google = stubGoogle(() => json({ romanizations: [{}] }));
      try {
        await expect(romanizeText('مرحبا', 'ar')).rejects.toBeInstanceOf(
          TransientAnnotationError,
        );
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      expect(google.calls()).toBe(3);
    });

    it('a 5xx is transient; a 400 is final even when its body mentions a 5xx-looking number', async () => {
      // The transient test used to match `\b5\d\d\b` anywhere in the
      // message, so a 400 whose body said "exceeds 512" was re-attempted on
      // every view.
      let google = stubGoogle(() =>
        json({ error: { code: 503, message: 'backend unavailable' } }, 503),
      );
      try {
        await expect(romanizeText('привет', 'ru')).rejects.toBeInstanceOf(
          TransientAnnotationError,
        );
        expect(google.calls()).toBe(3);
        vi.unstubAllGlobals();
        google = stubGoogle(() =>
          json(
            { error: { code: 400, message: 'Text exceeds 512 characters.' } },
            400,
          ),
        );
        const err: unknown = await romanizeText('привет', 'ru').catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TransientAnnotationError);
        expect(google.calls()).toBe(1);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    });

    it('does not retry Google v3 400 INVALID_ARGUMENT (unsupported source language)', async () => {
      // Telugu originally burned ROMANIZE_MAX_ATTEMPTS on a deterministic 400.
      // Client errors are not the empty-result flake the retry exists for.
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const serviceAccount = {
        client_email: 'tester@example.iam.gserviceaccount.com',
        private_key: privateKey as unknown as string,
        project_id: 'test-project',
      };
      vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', JSON.stringify(serviceAccount));

      let romanizeCalls = 0;
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('oauth2.googleapis.com')) {
          return new Response(JSON.stringify({ access_token: 'fake-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('translation.googleapis.com')) {
          romanizeCalls++;
          return new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: 'Source language is unsupported.',
                status: 'INVALID_ARGUMENT',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        await expect(romanizeText('привет', 'ru')).rejects.toThrow(
          /Google romanize API error: 400/,
        );
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      expect(romanizeCalls).toBe(1);
    });
  });
});
