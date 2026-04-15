/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";

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
      vi.stubEnv("OPENAI_API_KEY", "dummy");

      const googleBody = JSON.stringify({
        audioContent: Buffer.from("fake-mp3-bytes").toString("base64"),
      });
      const openAiBody = JSON.stringify({ text: "Hola" });

      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("texttospeech.googleapis.com")) {
          return new Response(googleBody, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("api.openai.com")) {
          return new Response(openAiBody, {
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
      expect(calls.some((c) => c.includes("api.openai.com"))).toBe(true);
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
});
