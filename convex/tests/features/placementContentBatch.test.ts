/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";

// Stub the aggregate component — production code instantiates
// `new TableAggregate(components.cardsByState, ...)` at module-load, and the
// aggregate component is not registered with convex-test here.
vi.mock("@convex-dev/aggregate", () => {
  class TableAggregate {
    constructor(_component: unknown, _opts: unknown) {}
    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async count(): Promise<number> {
      return 0;
    }
  }
  return { TableAggregate };
});

// Isolate the batching/self-continuation contract from `scheduleMissingContent`'s
// heavy internals (workpool enqueues + TTS/LLM/STT network). We only want to
// assert that the placement sweep bounds each transaction to one page and that
// the self-scheduled chain covers the whole corpus — the primitive itself is
// exercised end-to-end in `collectionBrowseAdd.test.ts`.
const { scheduleMissingContentSpy } = vi.hoisted(() => ({
  scheduleMissingContentSpy: vi.fn(async () => ({
    translationsScheduled: 1,
    audioScheduled: 1,
  })),
}));
vi.mock("../../features/decks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/decks")>()),
  scheduleMissingContent: scheduleMissingContentSpy,
}));

import schema from "../../schema";
import { internal } from "../../_generated/api";
import { PLACEMENT_CONTENT_BATCH_SIZE } from "../../../lib/constants/onboarding";
import type { Id } from "../../_generated/dataModel";

const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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

describe("placement content sweep — batched self-continuation", () => {
  // Regression guard for the "too many system operations" timeout: the sweep
  // must NOT run `scheduleMissingContent` over the whole corpus inline.
  it("bounds each invocation to one page and covers the whole corpus across the chain", async () => {
    const t = convexTest(schema, modules);
    const CORPUS = PLACEMENT_CONTENT_BATCH_SIZE + 3; // spans two pages
    const textIds = await seedPlacementCorpus(t, CORPUS);

    // Fake timers so the self-scheduled continuation can be drained via the
    // repo-standard `finishAllScheduledFunctions(vi.runAllTimers)`.
    vi.useFakeTimers();

    // First invocation: exactly one page of work, then it self-schedules.
    const first = await t.mutation(
      internal.features.onboarding.ensureAudioForTestTranslations,
      { targetLanguage: "es", sourceLanguage: "en" },
    );
    expect(scheduleMissingContentSpy).toHaveBeenCalledTimes(
      PLACEMENT_CONTENT_BATCH_SIZE,
    );
    // Mock returns {1,1} per sentence, so the returned tally reflects exactly
    // one bounded page — never the full corpus.
    expect(first.translationsScheduled).toBe(PLACEMENT_CONTENT_BATCH_SIZE);
    expect(first.audioScheduled).toBe(PLACEMENT_CONTENT_BATCH_SIZE);

    // Drain the self-scheduled continuation(s).
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Every placement sentence's text is processed exactly once, no more —
    // the batch chain covers the corpus without duplicating work.
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
});
