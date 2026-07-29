/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import schema from "../../schema";
import { api } from "../../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");

describe("setAnalyticsConsent", () => {
  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.features.consent.setAnalyticsConsent, { granted: true }),
    ).rejects.toThrow(ConvexError);
  });

  it("creates a settings row for a user who has none, without completing onboarding", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });

    await asUser.mutation(api.features.consent.setAnalyticsConsent, { granted: true });

    const settings = await t.run(async (ctx) =>
      ctx.db
        .query("userSettings")
        .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
        .unique(),
    );
    expect(settings?.analyticsConsent).toBe(true);
    // Only finalizeOnboarding may flip this true.
    expect(settings?.hasCompletedOnboarding).toBe(false);
  });

  it("updates an existing row in place and supports withdrawal", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: "user_A" });
    await t.run(async (ctx) =>
      ctx.db.insert("userSettings", {
        userId: "user_A",
        hasCompletedOnboarding: true,
      }),
    );

    await asUser.mutation(api.features.consent.setAnalyticsConsent, { granted: true });
    await asUser.mutation(api.features.consent.setAnalyticsConsent, { granted: false });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("userSettings")
        .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
        .collect(),
    );
    // Upsert, not insert: still exactly one row, onboarding state untouched.
    expect(rows).toHaveLength(1);
    expect(rows[0].analyticsConsent).toBe(false);
    expect(rows[0].hasCompletedOnboarding).toBe(true);
  });
});
