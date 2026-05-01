/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";

// The aggregate component instantiates at module-load time. Stub it so we can
// import the module without a registered aggregate component.
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

import { getCardStateLabel } from "../../../db/stats/cardAggregates";
import type { Doc } from "../../../_generated/dataModel";

// Build the minimum-viable card document the helper actually reads.
// Cast through `unknown` so TypeScript doesn't require the unused fields.
function makeCard(overrides: Partial<Doc<"cards">>): Doc<"cards"> {
  return {
    _id: "cards:test" as Doc<"cards">["_id"],
    _creationTime: 0,
    deckId: "decks:test" as Doc<"cards">["deckId"],
    textId: "texts:test" as Doc<"cards">["textId"],
    collectionId: "collections:test" as Doc<"cards">["collectionId"],
    dueDate: 0,
    isMastered: false,
    isHidden: false,
    schedulingPhase: "preReview",
    preReviewCount: 0,
    ...overrides,
  } as unknown as Doc<"cards">;
}

function withFsrsState(state: number): Partial<Doc<"cards">> {
  return {
    schedulingPhase: "review",
    fsrsState: {
      due: 0,
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state,
      lastReview: 0,
    },
  };
}

describe("getCardStateLabel", () => {
  it("returns 'hidden' when isHidden is true (overrides everything)", () => {
    const card = makeCard({ isHidden: true, isMastered: true, ...withFsrsState(2) });
    expect(getCardStateLabel(card)).toBe("hidden");
  });

  it("returns 'mastered' when isMastered is true (and not hidden)", () => {
    const card = makeCard({ isMastered: true, ...withFsrsState(2) });
    expect(getCardStateLabel(card)).toBe("mastered");
  });

  it("returns 'new' for cards in the preReview phase", () => {
    const card = makeCard({ schedulingPhase: "preReview", preReviewCount: 0 });
    expect(getCardStateLabel(card)).toBe("new");
  });

  it("returns 'new' for preReview cards even after some pre-review passes", () => {
    const card = makeCard({ schedulingPhase: "preReview", preReviewCount: 3 });
    expect(getCardStateLabel(card)).toBe("new");
  });

  it("returns 'new' when in review phase but fsrsState.state=0", () => {
    const card = makeCard(withFsrsState(0));
    expect(getCardStateLabel(card)).toBe("new");
  });

  it("returns 'learning' when fsrsState.state=1", () => {
    const card = makeCard(withFsrsState(1));
    expect(getCardStateLabel(card)).toBe("learning");
  });

  it("returns 'review' when fsrsState.state=2", () => {
    const card = makeCard(withFsrsState(2));
    expect(getCardStateLabel(card)).toBe("review");
  });

  it("returns 'relearning' when fsrsState.state=3", () => {
    const card = makeCard(withFsrsState(3));
    expect(getCardStateLabel(card)).toBe("relearning");
  });

  it("falls back to 'new' for an out-of-range state index", () => {
    const card = makeCard(withFsrsState(99));
    expect(getCardStateLabel(card)).toBe("new");
  });
});
