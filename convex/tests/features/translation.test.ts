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

    it("romanizes Arabic via Google v3 passing bare 'ar'", async () => {
      // Asserts the wire format we send for Arabic. Google's v3 romanizeText
      // wants bare `ar` (not `ar-SA` or any region tag) — guard so we don't
      // regress by adding a regional mapping that Google rejects.
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
            romanizeBody = init?.body
              ? JSON.parse(init.body as string)
              : null;
            return new Response(
              JSON.stringify({
                romanizations: [{ romanizedText: "marhaba" }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`Unexpected fetch to ${u}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      try {
        const out = await romanizeText("مرحبا", "ar");
        expect(out).toBe("marhaba");
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      expect(
        (romanizeBody as { source_language_code?: string } | null)
          ?.source_language_code,
      ).toBe("ar");
    });
  });
});
