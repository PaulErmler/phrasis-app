import { describe, it, expect } from "vitest";
import {
  deriveStreakDisplay,
  computeStreakUpdate,
} from "../../db/courseStats";

// Fixed reference day for all cases.
const TODAY = "2026-06-10";
const YESTERDAY = "2026-06-09"; // today - 1
const TWO_AGO = "2026-06-08"; // today - 2
const THREE_AGO = "2026-06-07"; // today - 3

describe("deriveStreakDisplay", () => {
  it("learned today → active, streak unchanged", () => {
    expect(deriveStreakDisplay(TODAY, TODAY, 5)).toEqual({
      displayStreak: 5,
      state: "active",
      freezeAvailable: true,
    });
  });

  it("learned yesterday, not today → pending, streak unchanged", () => {
    expect(deriveStreakDisplay(YESTERDAY, TODAY, 5)).toEqual({
      displayStreak: 5,
      state: "pending",
      freezeAvailable: true,
    });
  });

  it("missed yesterday but freeze available → frozen, streak unchanged", () => {
    expect(deriveStreakDisplay(TWO_AGO, TODAY, 5)).toEqual({
      displayStreak: 5,
      state: "frozen",
      freezeAvailable: true,
    });
  });

  it("missed yesterday with freeze unavailable (recently used) → broken, 0", () => {
    // Freeze covered 06-07 and hasn't regenerated yet (last activity 06-08 is
    // not strictly after getNextDay('2026-06-07') = '2026-06-08').
    expect(deriveStreakDisplay(TWO_AGO, TODAY, 5, "2026-06-07")).toEqual({
      displayStreak: 0,
      state: "broken",
      freezeAvailable: false,
    });
  });

  it("gap of 2+ days → broken, 0", () => {
    expect(deriveStreakDisplay(THREE_AGO, TODAY, 5)).toMatchObject({
      displayStreak: 0,
      state: "broken",
    });
  });

  it("no activity ever → none, 0", () => {
    expect(deriveStreakDisplay(undefined, TODAY, 0)).toMatchObject({
      displayStreak: 0,
      state: "none",
    });
  });

  it("regenerated freeze (old used date) → frozen at today-2", () => {
    // Freeze used long ago (06-01); last activity 06-08 is well past
    // getNextDay('2026-06-01') = '2026-06-02', so the freeze is available again.
    expect(deriveStreakDisplay(TWO_AGO, TODAY, 5, "2026-06-01")).toMatchObject({
      state: "frozen",
      freezeAvailable: true,
    });
  });

  it("handles month boundary (Feb→Mar, non-leap)", () => {
    expect(deriveStreakDisplay("2026-02-27", "2026-03-01", 4)).toMatchObject({
      displayStreak: 4,
      state: "frozen",
    });
  });

  it("handles leap-year month boundary (Feb 29)", () => {
    expect(deriveStreakDisplay("2024-02-28", "2024-03-01", 4)).toMatchObject({
      displayStreak: 4,
      state: "frozen",
    });
  });

  it("handles year boundary", () => {
    expect(deriveStreakDisplay("2026-12-30", "2027-01-01", 9)).toMatchObject({
      displayStreak: 9,
      state: "frozen",
    });
  });
});

describe("deriveStreakDisplay ↔ computeStreakUpdate consistency", () => {
  // The displayed number must equal what the user's next activity would leave
  // in the document, so the streak never jumps when they study.

  it("active: another activity today keeps the same streak", () => {
    const d = deriveStreakDisplay(TODAY, TODAY, 5);
    const next = computeStreakUpdate(TODAY, TODAY, 5, undefined, undefined);
    expect(next.newStreak).toBe(d.displayStreak); // 5 → 5
  });

  it("pending: studying today bumps the streak by one", () => {
    const d = deriveStreakDisplay(YESTERDAY, TODAY, 5);
    const next = computeStreakUpdate(YESTERDAY, TODAY, 5, undefined, undefined);
    expect(next.newStreak).toBe(d.displayStreak + 1); // 5 → 6
  });

  it("frozen: studying today consumes the freeze and bumps by one", () => {
    const d = deriveStreakDisplay(TWO_AGO, TODAY, 5);
    const next = computeStreakUpdate(TWO_AGO, TODAY, 5, undefined, undefined);
    expect(next.freezeConsumed).toBe(true);
    expect(next.newStreak).toBe(d.displayStreak + 1); // 5 → 6
  });

  it("broken (freeze unavailable): studying today resets to 1", () => {
    const d = deriveStreakDisplay(TWO_AGO, TODAY, 5, "2026-06-07");
    const next = computeStreakUpdate(TWO_AGO, TODAY, 5, undefined, "2026-06-07");
    expect(d.displayStreak).toBe(0);
    expect(next.newStreak).toBe(1);
  });

  it("broken (2+ day gap): studying today resets to 1", () => {
    const d = deriveStreakDisplay(THREE_AGO, TODAY, 5);
    const next = computeStreakUpdate(THREE_AGO, TODAY, 5, undefined, undefined);
    expect(d.displayStreak).toBe(0);
    expect(next.newStreak).toBe(1);
  });

  it("none: first-ever activity starts at 1", () => {
    const d = deriveStreakDisplay(undefined, TODAY, 0);
    const next = computeStreakUpdate(undefined, TODAY, 0, undefined, undefined);
    expect(d.displayStreak).toBe(0);
    expect(next.newStreak).toBe(1);
  });
});

describe("computeStreakUpdate (anchor cases for the consistency tests)", () => {
  it("consumes the freeze on a 1-day gap when available", () => {
    const r = computeStreakUpdate(TWO_AGO, TODAY, 3, undefined, undefined);
    expect(r).toMatchObject({
      newStreak: 4,
      freezeConsumed: true,
      newFreezeCount: 0,
      newFreezeUsedDate: YESTERDAY, // the skipped day
    });
  });

  it("resets the streak on a 2+ day gap without consuming a freeze", () => {
    const r = computeStreakUpdate(THREE_AGO, TODAY, 3, undefined, undefined);
    expect(r).toMatchObject({ newStreak: 1, freezeConsumed: false });
  });
});
