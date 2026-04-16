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
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { textsMatchSemantic } from "../../lib/ttsSemanticValidation";
const mockSemantic = vi.mocked(textsMatchSemantic);

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
      vi.stubEnv("ELEVENLABS_API_KEY", "dummy");

      const googleBody = JSON.stringify({
        audioContent: Buffer.from("fake-mp3-bytes").toString("base64"),
      });
      const scribeBody = JSON.stringify({
        text: "Hola",
        words: [{ text: "Hola", start: 0, end: 0.5, type: "word" }],
      });

      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("texttospeech.googleapis.com")) {
          return new Response(googleBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("api.elevenlabs.io/v1/speech-to-text")) {
          return new Response(scribeBody, {
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
      expect(calls.some((c) => c.includes("api.elevenlabs.io"))).toBe(true);
    });

    describe("validation retries", () => {
      /**
       * Seed + run the pipeline with a Scribe transcription that may or may
       * not match the original. Any retries call `textsMatchSemantic`, which
       * is mocked at the module boundary.
       */
      async function runPipeline(
        t: ReturnType<typeof convexTest>,
        textId: Awaited<ReturnType<typeof seedText>>["textId"],
        transcribedText: string,
      ) {
        vi.stubEnv("GOOGLE_TTS_API_KEY", "dummy");
        vi.stubEnv("ELEVENLABS_API_KEY", "dummy");

        const googleBody = JSON.stringify({
          audioContent: Buffer.from("fake-mp3").toString("base64"),
        });
        const scribeBody = JSON.stringify({
          text: transcribedText,
          words: [{ text: transcribedText, start: 0, end: 0.5, type: "word" }],
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === "string" ? url : url.toString();
          if (u.includes("texttospeech.googleapis.com")) {
            return new Response(googleBody, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (u.includes("api.elevenlabs.io/v1/speech-to-text")) {
            return new Response(scribeBody, {
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

      it("all three attempts strict+Gemini mismatch → unvalidated, 3 mismatches, 3 Gemini calls", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue("mismatch");

        await runPipeline(t, textId, "Ola amigo");

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe("unvalidated");
        // One Gemini call per attempt — strict fails first, then Gemini runs.
        expect(mockSemantic).toHaveBeenCalledTimes(3);
        const mismatches = await getMismatches(t, textId);
        expect(mismatches.length).toBe(3);
        expect(mismatches.map((m) => m.attempt).sort()).toEqual([1, 2, 3]);
      });

      it("Gemini error on every attempt → audio unvalidated (bad audio isn't silently accepted)", async () => {
        const t = convexTest(schema, modules);
        const { textId } = await seedText(t);
        mockSemantic.mockReset();
        mockSemantic.mockResolvedValue("error");

        await runPipeline(t, textId, "Ola amigo");

        const audio = await getAudio(t, textId);
        expect(audio?.ttsQuality).toBe("unvalidated");
        expect(mockSemantic).toHaveBeenCalledTimes(3);
        expect((await getMismatches(t, textId)).length).toBe(3);
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
        vi.stubEnv("ELEVENLABS_API_KEY", "dummy");
        const googleBody = JSON.stringify({
          audioContent: Buffer.from("fake").toString("base64"),
        });
        // Scribe transcription swaps 他 → 她 (same pinyin: "tā"). Strict
        // on hanzi would fail (edit distance 1 is the limit — but the
        // normalized hanzi are clearly different characters). Pinyin of
        // both is "tā zài jiā" — identical, so strict passes at
        // distance 0.
        const scribeBody = JSON.stringify({
          text: "她在家",
          words: [{ text: "她在家", start: 0, end: 0.5, type: "word" }],
        });
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
          const u = typeof url === "string" ? url : url.toString();
          if (u.includes("texttospeech.googleapis.com")) {
            return new Response(googleBody, { status: 200 });
          }
          if (u.includes("api.elevenlabs.io/v1/speech-to-text")) {
            return new Response(scribeBody, { status: 200 });
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
    // Every supported language is currently served by ElevenLabs, so any
    // legacy row with `ttsProvider: 'google'` should be swept out on first
    // touch. These tests drive that sweep via `prepareCardContent`.
    it("deletes a row whose ttsProvider doesn't match the language's current provider", async () => {
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
          language: "es",
          voiceName: "es-ES-Chirp3-HD-Leda",
          storageId,
          ttsQuality: "validated",
          ttsProvider: "google",
          voiceGender: "female",
          speed: 0.9,
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

      vi.stubEnv('ELEVENLABS_API_KEY', 'dummy');
      const scribeBody = JSON.stringify({
        text: 'Hola mundo',
        words: [
          { text: 'Hola', start: 0, end: 0.4, type: 'word' },
          { text: ' ', start: 0.4, end: 0.5, type: 'spacing' },
          { text: 'mundo', start: 0.5, end: 1.0, type: 'word' },
        ],
      });
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('api.elevenlabs.io')) {
          return new Response(scribeBody, {
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
      // Spacing entries are filtered out by transcribeAudio; only words land.
      expect(after?.wordTimings).toEqual([
        { word: 'Hola', start: 0, end: 0.4 },
        { word: 'mundo', start: 0.5, end: 1.0 },
      ]);
      expect(await getClaim(t, textId)).toBeNull();
    });

    it('skips persistence on empty wordTimings but still releases the claim', async () => {
      const t = convexTest(schema, modules);
      const { textId, storageId } = await seedAudioAndClaim(t);

      vi.stubEnv('ELEVENLABS_API_KEY', 'dummy');
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ text: '', words: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
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

    it('returns early without calling Scribe when the storage blob is missing, but still releases the claim', async () => {
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
        throw new Error('Scribe should not be called when blob is missing');
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.stubEnv('ELEVENLABS_API_KEY', 'dummy');

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

      vi.stubEnv('ELEVENLABS_API_KEY', 'dummy');
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
