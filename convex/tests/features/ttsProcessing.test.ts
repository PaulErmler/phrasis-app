/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";

// Mock the Gemini validator at the module boundary so tests control its
// verdict without touching the OpenRouter SDK or network.
vi.mock("../../lib/ttsSemanticValidation", () => ({
  textsMatchSemantic: vi.fn(),
}));

// Mock the rate limiter at the module boundary. The real component requires
// `t.registerComponent` setup (flagged fragile in this project) and would
// pull in the @convex-dev/rate-limiter component's tables. Tests that need
// a specific verdict from `rateLimiter.limit` reassign `mockLimit` below;
// the default resolved value lets STT-touching paths (`reserveAzureSttSlot`)
// pass through without per-test setup.
vi.mock("../../rateLimiter", () => ({
  rateLimiter: {
    limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
    check: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
  },
  TTS_RATE_LIMIT_BY_PROVIDER: {
    google: "googleTts",
    azure: "azureTts",
  },
}));

import { textsMatchSemantic } from "../../lib/ttsSemanticValidation";
import { rateLimiter } from "../../rateLimiter";
const mockSemantic = vi.mocked(textsMatchSemantic);
const mockLimit = vi.mocked(rateLimiter.limit);

const modules = import.meta.glob("/convex/**/*.ts");

async function seedText(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const collectionId = await ctx.db.insert("collections", {
      name: "A1",
      textCount: 1,
    });
    const textId = await ctx.db.insert("texts", {
      text: "Hola",
      language: "es",
      userCreated: false,
      collectionId,
      collectionRank: 1,
    });
    return { textId };
  });
}

describe("features/ttsProcessing", () => {
  describe("releaseTtsClaim", () => {
    it("no-ops when no claim exists", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const res = await t.mutation(
        internal.features.ttsProcessing.releaseTtsClaim,
        { textId, language: "es" },
      );
      expect(res).toBeNull();
    });

    it("deletes an existing claim", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("ttsGenerationClaims", {
          textId,
          language: "es",
          claimedAt: Date.now(),
        });
      });
      await t.mutation(internal.features.ttsProcessing.releaseTtsClaim, {
        textId,
        language: "es",
      });
      const left = await t.run(async (ctx) =>
        ctx.db
          .query("ttsGenerationClaims")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .first(),
      );
      expect(left).toBeNull();
    });
  });

  describe("storeTtsMismatch", () => {
    it("inserts a mismatch row", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      await t.mutation(internal.features.ttsProcessing.storeTtsMismatch, {
        textId,
        language: "es",
        voiceName: "es-ES-Chirp3-HD-Leda",
        storageId,
        expectedText: "Hola",
        transcribedText: "Ola",
        attempt: 1,
      });
      const row = await t.run(async (ctx) =>
        ctx.db
          .query("ttsMismatches")
          .withIndex("by_textId", (q) => q.eq("textId", textId))
          .first(),
      );
      expect(row?.transcribedText).toBe("Ola");
      expect(row?.attempt).toBe(1);
    });
  });

  describe("updateAudioRecordingQuality", () => {
    it("no-ops when no audio row exists", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const res = await t.mutation(
        internal.features.ttsProcessing.updateAudioRecordingQuality,
        { textId, language: "es", ttsQuality: "validated" },
      );
      expect(res).toBeNull();
    });

    it("updates quality on an existing audio row", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      await t.run(async (ctx) =>
        ctx.db.insert("audioRecordings", {
          textId,
          language: "es",
          voiceName: "es-ES-Chirp3-HD-Leda",
          storageId,
          ttsQuality: "unknown",
        }),
      );
      await t.mutation(
        internal.features.ttsProcessing.updateAudioRecordingQuality,
        { textId, language: "es", ttsQuality: "validated" },
      );
      const updated = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .first(),
      );
      expect(updated?.ttsQuality).toBe("validated");
    });
  });

  describe("processTTSForCard", () => {
    it("full pipeline: synthesizes, transcribes, validates and stores audio row", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      vi.stubEnv("GOOGLE_TTS_API_KEY", "dummy");
      vi.stubEnv("AZURE_SPEECH_API_KEY", "dummy");
      vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");

      const googleBody = JSON.stringify({
        audioContent: Buffer.from("fake-mp3-bytes").toString("base64"),
      });
      const azureSttBody = JSON.stringify({
        combinedPhrases: [{ text: "Hola" }],
        phrases: [
          {
            offsetMilliseconds: 0,
            durationMilliseconds: 500,
            text: "Hola",
            locale: "es-ES",
            words: [
              { text: "Hola", offsetMilliseconds: 0, durationMilliseconds: 500 },
            ],
          },
        ],
      });

      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("texttospeech.googleapis.com")) {
          return new Response(googleBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("speechtotext/transcriptions:transcribe")) {
          return new Response(azureSttBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      // Queue-based flow: pre-assign a slot like pumpQueue would, then invoke
      // the action directly. The action releases the slot in its finally block.
      const slotId = await t.run(async (ctx) =>
        ctx.db.insert("ttsProviderSlots", {
          provider: "google" as const,
          claimedAt: Date.now(),
        }),
      );

      try {
        await t.action(internal.features.ttsProcessing.processTTSForCard, {
          textId,
          text: "Hola",
          language: "es",
          voiceName: "es-ES-Chirp3-HD-Leda",
          provider: "google" as const,
          voiceGender: "female" as const,
          speed: 1,
          slotId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const audio = await t.run(async (ctx) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", "es"),
          )
          .first(),
      );
      expect(audio?.ttsQuality).toBe("validated");
      expect(audio?.voiceName).toBe("es-ES-Chirp3-HD-Leda");
      expect(audio?.voiceGender).toBe("female");
      expect(audio?.speed).toBe(1);
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((c) => c.includes("texttospeech"))).toBe(true);
      expect(
        calls.some((c) => c.includes("speechtotext/transcriptions:transcribe")),
      ).toBe(true);
    });

    describe("validation retries", () => {
      /**
       * Seed + run the pipeline with an Azure STT transcription that may or
       * may not match the original. Any retries call `textsMatchSemantic`,
       * which is mocked at the module boundary.
       */
      async function runPipeline(
        t: ReturnType<typeof convexTest>,
        textId: Awaited<ReturnType<typeof seedText>>["textId"],
        transcribedText: string,
      ) {
        vi.stubEnv("GOOGLE_TTS_API_KEY", "dummy");
        vi.stubEnv("AZURE_SPEECH_API_KEY", "dummy");
        vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");

        const googleBody = JSON.stringify({
          audioContent: Buffer.from("fake-mp3").toString("base64"),
        });
        const azureSttBody = JSON.stringify({
          combinedPhrases: [{ text: transcribedText }],
          phrases: [
            {
              offsetMilliseconds: 0,
              durationMilliseconds: 500,
              text: transcribedText,
              locale: "es-ES",
              words: [
                {
                  text: transcribedText,
                  offsetMilliseconds: 0,
                  durationMilliseconds: 500,
                },
              ],
            },
          ],
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === "string" ? url : url.toString();
          if (u.includes("texttospeech.googleapis.com")) {
            return new Response(googleBody, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (u.includes("speechtotext/transcriptions:transcribe")) {
            return new Response(azureSttBody, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          throw new Error(`Unexpected fetch to ${u}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const slotId = await t.run(async (ctx) =>
          ctx.db.insert("ttsProviderSlots", {
            provider: "google" as const,
            claimedAt: Date.now(),
          }),
        );

        try {
          await t.action(internal.features.ttsProcessing.processTTSForCard, {
            textId,
            text: "Hola",
            language: "es",
            voiceName: "es-ES-Chirp3-HD-Leda",
            provider: "google" as const,
            voiceGender: "female" as const,
            speed: 1,
            slotId,
          });
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }
      }

      async function getAudio(
        t: ReturnType<typeof convexTest>,
        textId: Awaited<ReturnType<typeof seedText>>["textId"],
      ) {
        return t.run(async (ctx) =>
          ctx.db
            .query("audioRecordings")
            .withIndex("by_text_and_language", (q) =>
              q.eq("textId", textId).eq("language", "es"),
            )
            .first(),
        );
      }

      async function getMismatches(
        t: ReturnType<typeof convexTest>,
        textId: Awaited<ReturnType<typeof seedText>>["textId"],
      ) {
        return t.run(async (ctx) =>
          ctx.db
            .query("ttsMismatches")
            .withIndex("by_textId", (q) => q.eq("textId", textId))
            .collect(),
        );
      }

      it("attempt 1 strict passes → no Gemini call, no mismatch recorded", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();

        await runPipeline(t, textId, "Hola");

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe("validated");
        expect(mockSemantic).not.toHaveBeenCalled();
        expect((await getMismatches(t, textId)).length).toBe(0);
      });

      it("strict fails + Gemini match on attempt 1 → validated with no mismatch logged", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValueOnce("match");

        // Transcription differs by > 1 edit → strict fails; Gemini rescues it
        // before any mismatch row is written.
        await runPipeline(t, textId, "Ola amigo");

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe("validated");
        expect(mockSemantic).toHaveBeenCalledTimes(1);
        expect((await getMismatches(t, textId)).length).toBe(0);
      });

      it("both attempts strict+Gemini mismatch → unvalidated, 2 mismatches, 2 Gemini calls", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue("mismatch");

        await runPipeline(t, textId, "Ola amigo");

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe("unvalidated");
        // One Gemini call per attempt — strict fails first, then Gemini runs.
        expect(mockSemantic).toHaveBeenCalledTimes(2);
        const mismatches = await getMismatches(t, textId);
        expect(mismatches.length).toBe(2);
        expect(mismatches.map((m) => m.attempt).sort()).toEqual([1, 2]);
      });

      it("Gemini error on every attempt → audio unvalidated (bad audio isn't silently accepted)", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue("error");

        await runPipeline(t, textId, "Ola amigo");

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe("unvalidated");
        expect(mockSemantic).toHaveBeenCalledTimes(2);
        expect((await getMismatches(t, textId)).length).toBe(2);
      });

      it("Chinese homophone swap passes strict via pinyin match → no Gemini call", async () => {
        // Seed a Chinese text — seedText uses 'es', so insert a fresh one.
        const t = convexTest(schema, modules);
        const zhTextId = await t.run(async (ctx) => {
          const collectionId = await ctx.db.insert("collections", {
            name: "A1",
            textCount: 1,
          });
          return ctx.db.insert("texts", {
            text: "他在家",
            language: "zh",
            userCreated: false,
            collectionId,
            collectionRank: 1,
          });
        });
        mockSemantic.mockReset();

        vi.stubEnv("GOOGLE_TTS_API_KEY", "dummy");
        vi.stubEnv("AZURE_SPEECH_API_KEY", "dummy");
        vi.stubEnv("AZURE_SPEECH_REGION", "westeurope");
        const googleBody = JSON.stringify({
          audioContent: Buffer.from("fake").toString("base64"),
        });
        // STT transcription swaps 他 → 她 (same pinyin: "tā"). Strict
        // on hanzi would fail (edit distance 1 is the limit — but the
        // normalized hanzi are clearly different characters). Pinyin of
        // both is "tā zài jiā" — identical, so strict passes at
        // distance 0.
        const azureSttBody = JSON.stringify({
          combinedPhrases: [{ text: "她在家" }],
          phrases: [
            {
              offsetMilliseconds: 0,
              durationMilliseconds: 500,
              text: "她在家",
              locale: "zh-CN",
              words: [
                {
                  text: "她在家",
                  offsetMilliseconds: 0,
                  durationMilliseconds: 500,
                },
              ],
            },
          ],
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === "string" ? url : url.toString();
          if (u.includes("texttospeech.googleapis.com")) {
            return new Response(googleBody, { status: 200 });
          }
          if (u.includes("speechtotext/transcriptions:transcribe")) {
            return new Response(azureSttBody, { status: 200 });
          }
          throw new Error(`Unexpected fetch to ${u}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const slotId = await t.run(async (ctx) =>
          ctx.db.insert("ttsProviderSlots", {
            provider: "google" as const,
            claimedAt: Date.now(),
          }),
        );

        try {
          await t.action(internal.features.ttsProcessing.processTTSForCard, {
            textId: zhTextId,
            text: "他在家",
            language: "zh",
            voiceName: "zh-CN-Chirp3-HD-Leda",
            provider: "google" as const,
            voiceGender: "female" as const,
            speed: 1,
            slotId,
          });
        } finally {
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }

        const audio = await t.run(async (ctx) =>
          ctx.db
            .query("audioRecordings")
            .withIndex("by_text_and_language", (q) =>
              q.eq("textId", zhTextId).eq("language", "zh"),
            )
            .first(),
        );
        expect(audio?.ttsQuality).toBe("validated");
        expect(mockSemantic).not.toHaveBeenCalled();
      });
    });
  });

  describe("scheduleMissingContent sweep", () => {
    // Swahili (Kenya) currently runs on Azure. Per lib/ttsPrecedence.ts, Azure
    // overrides ElevenLabs rows but leaves Google rows untouched. These tests
    // drive both branches via `prepareCardContent`.
    it("deletes a row whose ttsProvider is in the current provider's override list", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      // Force a stable audioSpeakerGender so the sweep compares like-for-like.
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: "female" }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const audioId = await t.run(async (ctx) =>
        ctx.db.insert("audioRecordings", {
          textId,
          language: "sw",
          voiceName: "RILOU7YmBhvwJGDGjNmP", // ElevenLabs voice id (Jane)
          storageId,
          ttsQuality: "validated",
          ttsProvider: "elevenlabs",
          voiceGender: "female",
          speed: 0.9,
        }),
      );

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ["sw"],
        targetLanguages: ["sw"],
      });

      const left = await t.run(async (ctx) => ctx.db.get(audioId));
      expect(left).toBeNull();
    });

    it("keeps a Google row when the language's active provider doesn't override Google", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: "female" }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const audioId = await t.run(async (ctx) =>
        ctx.db.insert("audioRecordings", {
          textId,
          language: "sw",
          voiceName: "sw-KE-Chirp3-HD-Leda",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "google",
          voiceGender: "female",
          speed: 0.9,
        }),
      );

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ["sw"],
        targetLanguages: ["sw"],
      });

      const left = await t.run(async (ctx) => ctx.db.get(audioId));
      expect(left).not.toBeNull();
    });

    it("deletes a legacy row whose gender can't be determined (no voiceGender + voice not in curated list)", async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.run(async (ctx) =>
        ctx.db.patch(textId, { audioSpeakerGender: "female" }),
      );
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      const audioId = await t.run(async (ctx) =>
        ctx.db.insert("audioRecordings", {
          textId,
          language: "es",
          voiceName: "unknown-voice-id-removed-from-list",
          storageId,
          ttsQuality: "validated",
          // Intentionally omit voiceGender and ttsProvider to simulate a
          // legacy row for a voice that's been removed from the curated list.
        }),
      );

      await t.mutation(internal.features.decks.prepareCardContent, {
        textId,
        baseLanguages: ["es"],
        targetLanguages: ["es"],
      });

      const left = await t.run(async (ctx) => ctx.db.get(audioId));
      expect(left).toBeNull();
    });
  });

  describe('queue priority ordering', () => {
    // The pump's contract: drain priority=1 rows (active collection) before
    // priority=0 (normal), oldest first within each level. Tested by writing
    // mixed rows and exercising the same index the pump uses.
    it('enqueueTtsJob defaults priority to 0 when omitted', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      await t.mutation(internal.features.ttsProcessing.enqueueTtsJob, {
        provider: 'google',
        args: {
          textId,
          text: 'Hola',
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          voiceGender: 'female',
          speed: 1,
        },
      });
      // The pump runs in a separate transaction now (scheduler.runAfter) to
      // avoid OCC contention with the re-enabled concurrency cap, so the
      // queue row is still visible when this mutation returns. Read it back
      // and assert priority defaulted to 0 — the contract this test exists
      // to enforce.
      const rows = await t.run((ctx) => ctx.db.query('ttsQueue').collect());
      expect(rows.length).toBe(1);
      expect(rows[0].priority).toBe(0);
    });

    it('priority=1 rows drain before priority=0 rows', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      // Pre-seed the queue directly so the pump hasn't already drained it.
      // queuedAt is set deliberately so that within priority=0 the older row
      // (50) comes before the newer (75), and the priority=1 row (queuedAt=100)
      // would lose under pure FIFO — yet must dispatch first under priority.
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsQueue', {
          provider: 'google',
          args: {
            textId,
            text: 'normal-old',
            language: 'es',
            voiceName: 'es-ES-Chirp3-HD-Leda',
            voiceGender: 'female',
            speed: 1,
          },
          queuedAt: 50,
          priority: 0,
        });
        await ctx.db.insert('ttsQueue', {
          provider: 'google',
          args: {
            textId,
            text: 'normal-new',
            language: 'es',
            voiceName: 'es-ES-Chirp3-HD-Leda',
            voiceGender: 'female',
            speed: 1,
          },
          queuedAt: 75,
          priority: 0,
        });
        await ctx.db.insert('ttsQueue', {
          provider: 'google',
          args: {
            textId,
            text: 'active-newest',
            language: 'es',
            voiceName: 'es-ES-Chirp3-HD-Leda',
            voiceGender: 'female',
            speed: 1,
          },
          queuedAt: 100,
          priority: 1,
        });
      });

      // Walk the same index pump uses: priority=1 first, then priority=0,
      // ordered by queuedAt within each level.
      const order: string[] = await t.run(async (ctx) => {
        const out: string[] = [];
        const high = await ctx.db
          .query('ttsQueue')
          .withIndex('by_provider_priority_and_queuedAt', (q) =>
            q.eq('provider', 'google').eq('priority', 1),
          )
          .order('asc')
          .collect();
        const normal = await ctx.db
          .query('ttsQueue')
          .withIndex('by_provider_priority_and_queuedAt', (q) =>
            q.eq('provider', 'google').eq('priority', 0),
          )
          .order('asc')
          .collect();
        for (const r of [...high, ...normal]) out.push(r.args.text);
        return out;
      });

      expect(order).toEqual(['active-newest', 'normal-old', 'normal-new']);
    });

    it('pumpQueue dispatches with zero delay when the rate limiter grants a token immediately', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert('ttsQueue', {
          provider: 'google',
          args: {
            textId,
            text: 'Hola',
            language: 'es',
            voiceName: 'es-ES-Chirp3-HD-Leda',
            voiceGender: 'female',
            speed: 1,
          },
          queuedAt: 0,
          priority: 0,
        });
      });

      mockLimit.mockResolvedValueOnce({ ok: true, retryAfter: 0 });

      await t.mutation(internal.features.ttsProcessing.pumpQueue, {
        provider: 'google',
      });

      const queueRows = await t.run((ctx) =>
        ctx.db.query('ttsQueue').collect(),
      );
      const slots = await t.run((ctx) =>
        ctx.db.query('ttsProviderSlots').collect(),
      );
      expect(queueRows.length).toBe(0);
      expect(slots.length).toBe(1);
      expect(mockLimit).toHaveBeenCalledWith(
        expect.anything(),
        'googleTts',
        { reserve: true },
      );
    });

    it('pumpQueue still dispatches but with the reserved delay when retryAfter > 0', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert('ttsQueue', {
          provider: 'google',
          args: {
            textId,
            text: 'Hola',
            language: 'es',
            voiceName: 'es-ES-Chirp3-HD-Leda',
            voiceGender: 'female',
            speed: 1,
          },
          queuedAt: 0,
          priority: 0,
        });
      });

      mockLimit.mockResolvedValueOnce({ ok: true, retryAfter: 5_000 });

      await t.mutation(internal.features.ttsProcessing.pumpQueue, {
        provider: 'google',
      });

      // Queue still drains and a slot is held even though dispatch is deferred —
      // the slot reserves the concurrency seat through the wait.
      const queueRows = await t.run((ctx) =>
        ctx.db.query('ttsQueue').collect(),
      );
      const slots = await t.run((ctx) =>
        ctx.db.query('ttsProviderSlots').collect(),
      );
      expect(queueRows.length).toBe(0);
      expect(slots.length).toBe(1);

      // Verify the scheduled action carries the rate-limiter's reservation delay.
      const scheduled = await t.run((ctx) =>
        ctx.db.system.query('_scheduled_functions').collect(),
      );
      const processCalls = scheduled.filter((s) =>
        s.name.includes('processTTSForCard'),
      );
      expect(processCalls.length).toBe(1);
      expect(processCalls[0].scheduledTime).toBeGreaterThan(Date.now() + 4_000);
    });

    it('pumpQueue stops dispatching and reschedules itself when rate limiter denies', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert('ttsQueue', {
          provider: 'google',
          args: {
            textId,
            text: 'Hola',
            language: 'es',
            voiceName: 'es-ES-Chirp3-HD-Leda',
            voiceGender: 'female',
            speed: 1,
          },
          queuedAt: 0,
          priority: 0,
        });
      });

      mockLimit.mockResolvedValueOnce({ ok: false, retryAfter: 30_000 });

      await t.mutation(internal.features.ttsProcessing.pumpQueue, {
        provider: 'google',
      });

      // Nothing dispatched: queue row untouched, no slot taken, no
      // processTTSForCard scheduled. A re-pump must be queued at retryAfter.
      const queueRows = await t.run((ctx) =>
        ctx.db.query('ttsQueue').collect(),
      );
      const slots = await t.run((ctx) =>
        ctx.db.query('ttsProviderSlots').collect(),
      );
      expect(queueRows.length).toBe(1);
      expect(slots.length).toBe(0);

      const scheduled = await t.run((ctx) =>
        ctx.db.system.query('_scheduled_functions').collect(),
      );
      const processCalls = scheduled.filter((s) =>
        s.name.includes('processTTSForCard'),
      );
      const pumpRescheduled = scheduled.filter((s) =>
        s.name.includes('pumpQueue'),
      );
      expect(processCalls.length).toBe(0);
      expect(pumpRescheduled.length).toBeGreaterThanOrEqual(1);
      expect(
        pumpRescheduled.some(
          (s) => s.scheduledTime > Date.now() + 25_000,
        ),
      ).toBe(true);
    });

    it('llmTranslationQueue priority=1 drains before priority=0', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);

      await t.run(async (ctx) => {
        await ctx.db.insert('llmTranslationQueue', {
          args: {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'es',
            text: 'normal-old',
          },
          queuedAt: 50,
          priority: 0,
        });
        await ctx.db.insert('llmTranslationQueue', {
          args: {
            textId,
            sourceLanguage: 'en',
            targetLanguage: 'es',
            text: 'active-newest',
          },
          queuedAt: 100,
          priority: 1,
        });
      });

      const order: string[] = await t.run(async (ctx) => {
        const out: string[] = [];
        const high = await ctx.db
          .query('llmTranslationQueue')
          .withIndex('by_priority_and_queuedAt', (q) => q.eq('priority', 1))
          .order('asc')
          .collect();
        const normal = await ctx.db
          .query('llmTranslationQueue')
          .withIndex('by_priority_and_queuedAt', (q) => q.eq('priority', 0))
          .order('asc')
          .collect();
        for (const r of [...high, ...normal]) out.push(r.args.text);
        return out;
      });

      expect(order).toEqual(['active-newest', 'normal-old']);
    });
  });

  describe('persistBackfilledWordTimings', () => {
    it('no-ops when no audio row exists', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const fakeStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      const res = await t.mutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        {
          textId,
          language: 'es',
          storageId: fakeStorageId,
          wordTimings: [{ word: 'hola', start: 0, end: 0.5 }],
        },
      );
      expect(res).toBeNull();
    });

    it('no-ops when storageId differs (stale-blob guard)', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const liveStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      const staleStorageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([2])])),
      );
      await t.run(async (ctx) =>
        ctx.db.insert('audioRecordings', {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId: liveStorageId,
          ttsQuality: 'validated',
        }),
      );
      await t.mutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        {
          textId,
          language: 'es',
          storageId: staleStorageId, // doesn't match the live row
          wordTimings: [{ word: 'hola', start: 0, end: 0.5 }],
        },
      );
      const after = await t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'es'),
          )
          .first(),
      );
      expect(after?.wordTimings).toBeUndefined();
    });

    it('patches wordTimings when storageId matches and leaves other fields intact', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      await t.run(async (ctx) =>
        ctx.db.insert('audioRecordings', {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId,
          ttsQuality: 'validated',
          voiceGender: 'female',
          speed: 0.9,
        }),
      );
      const wordTimings = [
        { word: 'hola', start: 0, end: 0.5 },
        { word: 'mundo', start: 0.5, end: 1.0 },
      ];
      await t.mutation(
        internal.features.ttsProcessing.persistBackfilledWordTimings,
        { textId, language: 'es', storageId, wordTimings },
      );
      const after = await t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'es'),
          )
          .first(),
      );
      expect(after?.wordTimings).toEqual(wordTimings);
      expect(after?.voiceName).toBe('es-ES-Chirp3-HD-Leda');
      expect(after?.voiceGender).toBe('female');
      expect(after?.speed).toBe(0.9);
      expect(after?.ttsQuality).toBe('validated');
    });
  });

  describe('backfillWordTimings', () => {
    /** Insert audio row + TTS claim. Returns ids for use in the action call. */
    async function seedAudioAndClaim(t: ReturnType<typeof convexTest>) {
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])])),
      );
      await t.run(async (ctx) => {
        await ctx.db.insert('audioRecordings', {
          textId,
          language: 'es',
          voiceName: 'es-ES-Chirp3-HD-Leda',
          storageId,
          ttsQuality: 'validated',
        });
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
      });
      return { textId, storageId };
    }

    async function getClaim(
      t: ReturnType<typeof convexTest>,
      textId: Awaited<ReturnType<typeof seedText>>['textId'],
    ) {
      return t.run(async (ctx) =>
        ctx.db
          .query('ttsGenerationClaims')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'es'),
          )
          .first(),
      );
    }

    async function getAudio(
      t: ReturnType<typeof convexTest>,
      textId: Awaited<ReturnType<typeof seedText>>['textId'],
    ) {
      return t.run(async (ctx) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', 'es'),
          )
          .first(),
      );
    }

    it('persists timings on success and releases the TTS claim', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);

      vi.stubEnv('AZURE_SPEECH_API_KEY', 'dummy');
      vi.stubEnv('AZURE_SPEECH_REGION', 'westeurope');
      const azureSttBody = JSON.stringify({
        combinedPhrases: [{ text: 'Hola mundo' }],
        phrases: [
          {
            offsetMilliseconds: 0,
            durationMilliseconds: 1000,
            text: 'Hola mundo',
            locale: 'es-ES',
            words: [
              { text: 'Hola', offsetMilliseconds: 0, durationMilliseconds: 400 },
              { text: 'mundo', offsetMilliseconds: 500, durationMilliseconds: 500 },
            ],
          },
        ],
      });
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('speechtotext/transcriptions:transcribe')) {
          return new Response(azureSttBody, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch to ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const after = await getAudio(t, textId);
      expect(after?.wordTimings).toEqual([
        { word: 'Hola', start: 0, end: 0.4 },
        { word: 'mundo', start: 0.5, end: 1.0 },
      ]);
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('skips persistence on empty wordTimings but still releases the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);

      vi.stubEnv('AZURE_SPEECH_API_KEY', 'dummy');
      vi.stubEnv('AZURE_SPEECH_REGION', 'westeurope');
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ combinedPhrases: [{ text: '' }], phrases: [] }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const after = await getAudio(t, textId);
      expect(after?.wordTimings).toBeUndefined();
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('returns early without calling STT when the storage blob is missing, but still releases the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId } = await seedText(t);
      const storageId = await t.run(async (ctx) =>
        ctx.storage.store(new Blob([new Uint8Array([1])])),
      );
      await t.run(async (ctx) => {
        await ctx.db.insert('ttsGenerationClaims', {
          textId,
          language: 'es',
          claimedAt: Date.now(),
        });
        await ctx.storage.delete(storageId);
      });

      const fetchMock = vi.fn(async () => {
        throw new Error('STT should not be called when blob is missing');
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.stubEnv('AZURE_SPEECH_API_KEY', 'dummy');
      vi.stubEnv('AZURE_SPEECH_REGION', 'westeurope');

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('still releases the claim when transcribeAudio throws', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);

      vi.stubEnv('AZURE_SPEECH_API_KEY', 'dummy');
      vi.stubEnv('AZURE_SPEECH_REGION', 'westeurope');
      const fetchMock = vi.fn(
        async () =>
          new Response('boom', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await t.action(internal.features.ttsProcessing.backfillWordTimings, {
          textId,
          language: 'es',
          storageId,
        });
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }

      const after = await getAudio(t, textId);
      expect(after?.wordTimings).toBeUndefined();
      expect(await getClaim(t, textId)).toBeNull();
    });
  });
});
