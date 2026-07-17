/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";

// Isolate the fan-out contract from `scheduleMissingContent`'s heavy
// internals (workpool enqueues + TTS/LLM/STT network). We only want to
// assert that the placement sweep bounds each transaction to one batch and
// that the upfront-queued batch workers cover the whole corpus — the
// primitive itself is exercised end-to-end in `collectionBrowseAdd.test.ts`.
const { scheduleMissingContentSpy, defaultScheduleMissingContent } = vi.hoisted(() => {
  const defaultScheduleMissingContent = async () => ({
    translationsScheduled: 1,
    audioScheduled: 1,
  });
  return {
    defaultScheduleMissingContent,
    // Declared with a rest signature so the poison tests can install
    // per-textId implementations without fighting the inferred zero-arg type.
    scheduleMissingContentSpy: vi.fn<
      (...args: unknown[]) => Promise<{ translationsScheduled: number; audioScheduled: number }>
        >(defaultScheduleMissingContent),
  };
});
vi.mock("../../features/decks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/decks")>()),
  scheduleMissingContent: scheduleMissingContentSpy,
}));

import schema from "../../schema";
import { internal } from "../../_generated/api";
import {
  PLACEMENT_BATCH_MAX_ATTEMPTS,
  PLACEMENT_CONTENT_BATCH_SIZE,
} from "../../../lib/constants/onboarding";
import type { Id } from "../../_generated/dataModel";

const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  // `clearAllMocks` clears calls but keeps implementations — restore the
  // default so a test's poisoned impl can't leak into the next one.
  scheduleMissingContentSpy.mockImplementation(defaultScheduleMissingContent);
});

/**
 * Seed a placement corpus larger than one batch: `count` English texts, each
 * with a matching `placementTestSentences` row. Returns the text ids in order.
 */
async function seedPlacementCorpus(
  t: ReturnType<typeof convexTest>,
  count: number,
): Promise<Id<"texts">[]> {
  return t.run(async (ctx) => {
    const collId = await ctx.db.insert("collections", {
      name: "placement-test-pool",
      textCount: count,
      origin: "premade",
    });
    const ids: Id<"texts">[] = [];
    for (let i = 0; i < count; i++) {
      const textId = await ctx.db.insert("texts", {
        text: `placement ${i}`,
        language: "en",
        userCreated: false,
        collectionId: collId,
        collectionRank: i,
      });
      await ctx.db.insert("placementTestSentences", {
        level: Math.floor(i / 5) + 1,
        position: i % 5,
        textId,
      });
      ids.push(textId);
    }
    return ids;
  });
}

describe("placement content sweep — upfront batch fan-out", () => {
  // Regression guard for the "too many system operations" timeout: the sweep
  // must NOT run `scheduleMissingContent` over the whole corpus inline.
  it("bounds the entry invocation to one page and covers the whole corpus via the fanned-out batches", async () => {
    const t = convexTest(schema, modules);
    const CORPUS = PLACEMENT_CONTENT_BATCH_SIZE + 3; // spans two batches
    const textIds = await seedPlacementCorpus(t, CORPUS);

    // Fake timers so the fanned-out batch workers can be drained via the
    // repo-standard `finishAllScheduledFunctions(vi.runAllTimers)`.
    vi.useFakeTimers();

    // Entry invocation: exactly one page of inline work; the remaining
    // batches are queued upfront as independent workers.
    const first = await t.mutation(
      internal.features.onboarding.ensureAudioForTestTranslations,
      { targetLanguage: "es", sourceLanguage: "en" },
    );
    expect(scheduleMissingContentSpy).toHaveBeenCalledTimes(
      PLACEMENT_CONTENT_BATCH_SIZE,
    );
    // Mock returns {1,1} per sentence, so the returned tally reflects exactly
    // the inline page — never the full corpus.
    expect(first.translationsScheduled).toBe(PLACEMENT_CONTENT_BATCH_SIZE);
    expect(first.audioScheduled).toBe(PLACEMENT_CONTENT_BATCH_SIZE);

    // Drain the fanned-out batch workers.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Every placement sentence's text is processed exactly once, no more —
    // the disjoint batches cover the corpus without duplicating work.
    expect(scheduleMissingContentSpy).toHaveBeenCalledTimes(CORPUS);
    const processedTextIds = scheduleMissingContentSpy.mock.calls.map(
      (call) => call[1] as Id<"texts">,
    );
    expect(new Set(processedTextIds)).toEqual(new Set(textIds));
  });

  it("passes source + target languages through to scheduleMissingContent", async () => {
    const t = convexTest(schema, modules);
    await seedPlacementCorpus(t, 1);

    vi.useFakeTimers();
    await t.mutation(internal.features.onboarding.enqueueMissingPlacementTranslations, {
      targetLanguage: "es",
      sourceLanguage: "de",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(scheduleMissingContentSpy).toHaveBeenCalledTimes(1);
    const [, , , baseLanguages, targetLanguages] =
      scheduleMissingContentSpy.mock.calls[0];
    // Source audio comes from the text's own language ("en"); the two chosen
    // languages become translation targets (text's own language filtered out).
    expect(baseLanguages).toEqual(["en"]);
    expect(new Set(targetLanguages as string[])).toEqual(new Set(["es", "de"]));
  });

  // The batches are INDEPENDENT — queued upfront by the entry mutation, not
  // chained — so one failing batch must not orphan the batches after it. (A
  // self-continuing chain would die at the first failing page: the next
  // page's enqueue rolls back with the failing transaction and Convex does
  // not retry failed scheduled mutations.)
  it("still processes later batches when an earlier scheduled batch fails", async () => {
    const t = convexTest(schema, modules);
    const CORPUS = PLACEMENT_CONTENT_BATCH_SIZE * 2 + 3; // inline page + 2 scheduled batches
    const textIds = await seedPlacementCorpus(t, CORPUS);
    // First text of the FIRST scheduled batch (the inline page is [0, BATCH)).
    const poisonedId = textIds[PLACEMENT_CONTENT_BATCH_SIZE];
    scheduleMissingContentSpy.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === poisonedId) throw new Error("poisoned placement sentence");
      return { translationsScheduled: 1, audioScheduled: 1 };
    });

    vi.useFakeTimers();
    const first = await t.mutation(
      internal.features.onboarding.ensureAudioForTestTranslations,
      { targetLanguage: "es", sourceLanguage: "en" },
    );
    // Inline page is unaffected by the downstream poison.
    expect(first.translationsScheduled).toBe(PLACEMENT_CONTENT_BATCH_SIZE);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Every text of the SECOND scheduled batch was processed even though the
    // first scheduled batch died mid-transaction.
    const processed = new Set(
      scheduleMissingContentSpy.mock.calls.map((call) => call[1] as Id<"texts">),
    );
    for (const id of textIds.slice(PLACEMENT_CONTENT_BATCH_SIZE * 2)) {
      expect(processed.has(id)).toBe(true);
    }
  });

  // A throw in the INLINE page rejects the client-observed mutation and rolls
  // back the batch enqueues with it — the placement test's reject-driven
  // retry path stays intact and no half-scheduled sweep survives.
  it("rejects the entry mutation (and enqueues nothing) when the inline page fails", async () => {
    const t = convexTest(schema, modules);
    const CORPUS = PLACEMENT_CONTENT_BATCH_SIZE + 3;
    const textIds = await seedPlacementCorpus(t, CORPUS);
    const poisonedId = textIds[0];
    scheduleMissingContentSpy.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === poisonedId) throw new Error("poisoned placement sentence");
      return { translationsScheduled: 1, audioScheduled: 1 };
    });

    vi.useFakeTimers();
    await expect(
      t.mutation(internal.features.onboarding.ensureAudioForTestTranslations, {
        targetLanguage: "es",
        sourceLanguage: "en",
      }),
    ).rejects.toThrow("poisoned placement sentence");

    // The rolled-back entry left no scheduled batches behind: the poisoned
    // first call is the only one that ever happened.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(scheduleMissingContentSpy).toHaveBeenCalledTimes(1);
  });
});

describe("placement content sweep — batch self-retry", () => {
  // Convex does not retry scheduled mutations on application error; the batch
  // worker reschedules itself. Without the retry, every sentence of a
  // transiently-failed batch stayed content-less for the rest of onboarding
  // (the client's awaited mutation already resolved, so its retry/toast path
  // never fires for scheduled-batch failures).
  it("retries a transiently failed batch so the whole corpus is still covered", async () => {
    const t = convexTest(schema, modules);
    const CORPUS = PLACEMENT_CONTENT_BATCH_SIZE * 2 + 3; // inline page + 2 scheduled batches
    const textIds = await seedPlacementCorpus(t, CORPUS);
    // First text of the FIRST scheduled batch: the throw kills that batch's
    // transaction, so its remaining texts are only covered if a retry re-runs
    // the slice.
    const poisonedId = textIds[PLACEMENT_CONTENT_BATCH_SIZE];
    let poisonedCalls = 0;
    scheduleMissingContentSpy.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === poisonedId && poisonedCalls++ === 0) {
        throw new Error("transient placement failure");
      }
      return { translationsScheduled: 1, audioScheduled: 1 };
    });

    vi.useFakeTimers();
    await t.mutation(internal.features.onboarding.ensureAudioForTestTranslations, {
      targetLanguage: "es",
      sourceLanguage: "en",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The retried batch re-ran its full slice, so every placement sentence —
    // including the ones AFTER the poisoned text in the failed batch — was
    // processed.
    const processed = new Set(
      scheduleMissingContentSpy.mock.calls.map((call) => call[1] as Id<"texts">),
    );
    expect(processed).toEqual(new Set(textIds));
    // Exactly one failed attempt + one successful re-run for the poisoned text.
    expect(poisonedCalls).toBe(2);
  });

  it("caps the retry chain at PLACEMENT_BATCH_MAX_ATTEMPTS and leaves other batches untouched", async () => {
    const t = convexTest(schema, modules);
    const CORPUS = PLACEMENT_CONTENT_BATCH_SIZE * 2 + 3; // inline page + 2 scheduled batches
    const textIds = await seedPlacementCorpus(t, CORPUS);
    const poisonedId = textIds[PLACEMENT_CONTENT_BATCH_SIZE];
    scheduleMissingContentSpy.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === poisonedId) throw new Error("permanent placement failure");
      return { translationsScheduled: 1, audioScheduled: 1 };
    });

    vi.useFakeTimers();
    await t.mutation(internal.features.onboarding.ensureAudioForTestTranslations, {
      targetLanguage: "es",
      sourceLanguage: "en",
    });
    // Draining to completion also proves the chain is finite — an unbounded
    // reschedule loop would never run out of scheduled functions.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The poisoned text was attempted exactly once per attempt, then given up.
    const poisonedCalls = scheduleMissingContentSpy.mock.calls.filter(
      (call) => call[1] === poisonedId,
    ).length;
    expect(poisonedCalls).toBe(PLACEMENT_BATCH_MAX_ATTEMPTS);

    // Inline page and the second scheduled batch are unaffected by the
    // doomed batch's retries.
    const processed = new Set(
      scheduleMissingContentSpy.mock.calls.map((call) => call[1] as Id<"texts">),
    );
    for (const id of [
      ...textIds.slice(0, PLACEMENT_CONTENT_BATCH_SIZE),
      ...textIds.slice(PLACEMENT_CONTENT_BATCH_SIZE * 2),
    ]) {
      expect(processed.has(id)).toBe(true);
    }
  });
});
