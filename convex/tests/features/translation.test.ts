/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { romanizeText } from "../../features/translation";

// translation.ts exposes shared helpers (no Convex functions).
// Only the zh/el/ko paths are pure (local libs); the v2/v3 Google paths
// require network + credentials and are covered via integration tests.
describe("features/translation helpers", () => {
  describe("romanizeText", () => {
    it("romanizes Chinese with pinyin", async () => {
      const out = await romanizeText("你好", "zh");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      // pinyin for 你好 starts with "n" + some vowel (tone-marked or not)
      expect(out.toLowerCase()).toMatch(/^n/);
    });

    it("romanizes Greek with phonetic Latin mapping", async () => {
      const out = await romanizeText("Γειά", "el");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });

    it("romanizes Korean Hangul via Revised Romanization", async () => {
      const out = await romanizeText("안녕", "ko");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });

    it("romanizes Russian via Google v3", async () => {
      // Generate a real RSA keypair so `importPKCS8` + JWT signing succeed.
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const serviceAccount = {
        client_email: "tester@example.iam.gserviceaccount.com",
        private_key: privateKey as unknown as string,
        project_id: "test-project",
      };
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", JSON.stringify(serviceAccount));

      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("oauth2.googleapis.com")) {
          return new Response(
            JSON.stringify({ access_token: "fake-token" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("translation.googleapis.com")) {
          return new Response(
            JSON.stringify({
              romanizations: [{ romanizedText: "privet" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      try {
        const out = await romanizeText("привет", "ru");
        expect(out).toBe("privet");
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      expect(fetchMock).toHaveBeenCalled();
    });

    it("throws cleanly (without hitting the network) for languages outside GOOGLE_V3_ROMANIZE_SUPPORTED", async () => {
      // Polish has no local romanizer and is not in Google v3's supported list,
      // so romanizeText should throw via the hard gate before any HTTP call.
      // We stub fetch with a "must not be called" assertion so a regression
      // that bypassed the gate would surface as a clear failure.
      const fetchMock = vi.fn(async () => {
        throw new Error(
          "romanizeText hit the network for an unsupported language — the hard gate regressed",
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      try {
        await expect(romanizeText("dzień dobry", "pl")).rejects.toThrow(
          /Romanization not configured/i,
        );
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("romanizes Arabic locally via arabic-transliterate (no network call)", async () => {
      // Arabic was moved OFF Google v3 after a production regression where
      // the endpoint started returning `{"romanizations":[{}]}` for short
      // Arabic strings. arabic-transliterate is now the local source of
      // truth — guard against accidentally re-routing `ar*` back to Google.
      const fetchMock = vi.fn(async () => {
        throw new Error(
          "romanizeText hit the network for Arabic — local path regressed",
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        const out = await romanizeText("مرحبا", "ar");
        // Library output is deterministic IJMES; assert non-empty + Latin.
        expect(out.length).toBeGreaterThan(0);
        expect(/[A-Za-zāēīōū]/.test(out)).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Arabic dialect codes (ar_sa / ar_eg / ar_iq / ar_lev) also use the local path", async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error(
          "Arabic dialect romanization hit the network — local path regressed",
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        for (const code of ["ar_sa", "ar_eg", "ar_iq", "ar_lev"] as const) {
          const out = await romanizeText("هلو", code);
          expect(out.length).toBeGreaterThan(0);
        }
      } finally {
        vi.unstubAllGlobals();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Google v3 callers (Russian) get retried up to 3 times before failing", async () => {
      // The 3-retry wrapper applies to every language still routed through
      // Google v3. We exercise it with Russian since `ar` no longer reaches
      // this path. The mock returns `{romanizations:[{}]}` every time —
      // simulating the Google flake that prompted the retry — and we assert
      // the fetch was attempted exactly ROMANIZE_MAX_ATTEMPTS times before
      // the final throw.
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const serviceAccount = {
        client_email: "tester@example.iam.gserviceaccount.com",
        private_key: privateKey as unknown as string,
        project_id: "test-project",
      };
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", JSON.stringify(serviceAccount));

      let romanizeCalls = 0;
      let romanizeBody: unknown = null;
      const fetchMock = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const u = typeof url === "string" ? url : url.toString();
          if (u.includes("oauth2.googleapis.com")) {
            return new Response(
              JSON.stringify({ access_token: "fake-token" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (u.includes("translation.googleapis.com")) {
            romanizeCalls++;
            romanizeBody = init?.body
              ? JSON.parse(init.body as string)
              : null;
            // Always-empty response — same shape we saw from production.
            return new Response(
              JSON.stringify({ romanizations: [{}] }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`Unexpected fetch to ${u}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      try {
        await expect(romanizeText("привет", "ru")).rejects.toThrow(
          /No romanization returned/i,
        );
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      expect(romanizeCalls).toBe(3);
      // Wire format guard — keep on a still-Google-routed language now that
      // Arabic no longer covers it.
      expect(
        (romanizeBody as { source_language_code?: string } | null)
          ?.source_language_code,
      ).toBe("ru");
    });

    it("Google v3 succeeds on a later retry attempt (recovery path)", async () => {
      // The whole point of the retry: a transient empty response on attempt
      // 1 shouldn't doom the row. Mock returns empty once, then a real
      // romanization on attempt 2 — the function should return the latter.
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const serviceAccount = {
        client_email: "tester@example.iam.gserviceaccount.com",
        private_key: privateKey as unknown as string,
        project_id: "test-project",
      };
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", JSON.stringify(serviceAccount));

      let romanizeCalls = 0;
      const fetchMock = vi.fn(
        async (url: string | URL | Request) => {
          const u = typeof url === "string" ? url : url.toString();
          if (u.includes("oauth2.googleapis.com")) {
            return new Response(
              JSON.stringify({ access_token: "fake-token" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (u.includes("translation.googleapis.com")) {
            romanizeCalls++;
            if (romanizeCalls === 1) {
              return new Response(
                JSON.stringify({ romanizations: [{}] }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            return new Response(
              JSON.stringify({
                romanizations: [{ romanizedText: "privet" }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`Unexpected fetch to ${u}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      try {
        const out = await romanizeText("привет", "ru");
        expect(out).toBe("privet");
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
      expect(romanizeCalls).toBe(2);
    });
  });
});
