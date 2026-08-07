/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { derivePlan, findPayableInvoiceUrl } from "../../usage/tracking";
import { ARCHIVE_COOLDOWN_MS } from "../../../lib/constants/courses";

const modules = import.meta.glob("/convex/**/*.ts");

// consumeQuota/releaseQuota schedule the REAL trackUsage action, and
// convex-test executes scheduled jobs on a timer — with fetch unstubbed that
// job would hit the live Autumn API whenever AUTUMN_SECRET_KEY happens to be
// in the runner's env. Stubbed at module scope (not per-test) so a job that
// fires after a test's cleanup still hits the stub, never the network.
// The mock reference is kept so individual tests can reroute specific
// endpoints (see the chargeExtraChatCredits describe).
const okResponse = () => ({
  ok: true,
  status: 200,
  text: async () => "{}",
  json: async () => ({}),
});
const fetchMock = vi.fn(async (..._args: unknown[]) => okResponse());
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  // Re-stubbed per test because the hooks-gating describe below clears all
  // env stubs in its afterEach.
  vi.stubEnv("AUTUMN_SECRET_KEY", "am_sk_test_stub");
});

const FEATURES: Record<
  string,
  { balance: number; included: number; used: number; unlimited?: boolean }
> = {
  chat_messages: { balance: 10, included: 10, used: 0 },
};

/**
 * Drive syncAllFeatures the way the real sync paths do. `planStatus`
 * undefined means "Autumn named no current plan"; `productsMissing` means it
 * returned nothing at all, which is a different (unknown) state.
 */
function sync(
  t: TestConvex<typeof schema>,
  planStatus: string | undefined,
  opts: {
    productsMissing?: boolean;
    anyPastDue?: boolean;
    features?: typeof FEATURES;
    pastDueInvoiceUrl?: string;
  } = {},
) {
  const planId = planStatus === undefined ? undefined : "pro";
  return t.mutation(internal.usage.helpers.syncAllFeatures, {
    userId: "user_A",
    features: opts.features ?? FEATURES,
    anyPastDue: opts.anyPastDue ?? planStatus === "past_due",
    productsMissing: opts.productsMissing ?? false,
    ...(opts.pastDueInvoiceUrl !== undefined
      ? { pastDueInvoiceUrl: opts.pastDueInvoiceUrl }
      : {}),
    ...(planId !== undefined ? { planId, planName: "Pro", planStatus } : {}),
  });
}

async function getQuotaDoc(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    ctx.db
      .query("usageQuotas")
      .withIndex("by_userId", (q) => q.eq("userId", "user_A"))
      .first(),
  );
}

/** FEATURES plus a `courses` entry — what drives the auto-archival path. */
const withCourses = (state: {
  balance: number;
  included: number;
  used: number;
}) => ({ ...FEATURES, courses: state });

/**
 * Seed `count` active courses (creation order = index order, which is the
 * order the auto-archival slice walks). Optionally seed the userSettings row
 * pointing `activeCourseId` at one of them.
 */
async function seedCourses(
  t: TestConvex<typeof schema>,
  count: number,
  opts: { activeIndex?: number } = {},
): Promise<Id<"courses">[]> {
  return t.run(async (ctx) => {
    const ids: Id<"courses">[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await ctx.db.insert("courses", {
          userId: "user_A",
          baseLanguages: ["en"],
          targetLanguages: ["de"],
          isArchived: false,
        }),
      );
    }
    if (opts.activeIndex !== undefined) {
      await ctx.db.insert("userSettings", {
        userId: "user_A",
        hasCompletedOnboarding: true,
        activeCourseId: ids[opts.activeIndex],
      });
    }
    return ids;
  });
}

async function readCourses(
  t: TestConvex<typeof schema>,
  ids: Id<"courses">[],
) {
  return t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
}

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  plan_id: "pro",
  status: "active",
  add_on: false,
  started_at: 0,
  ...over,
});

describe("usage — derivePlan", () => {
  it("flags past_due from the boolean encoding", () => {
    const d = derivePlan({
      id: "c",
      subscriptions: [entry({ past_due: true })],
    } as never);
    expect(d.anyPastDue).toBe(true);
    expect(d.plan?.planStatus).toBe("past_due");
  });

  it("flags past_due from the status encoding", () => {
    const d = derivePlan({
      id: "c",
      subscriptions: [entry({ status: "past_due" })],
    } as never);
    expect(d.anyPastDue).toBe(true);
    expect(d.plan?.planStatus).toBe("past_due");
  });

  it("is not masked by a co-existing healthy plan", () => {
    // The old pick() preferred `active && !past_due`, which hid the
    // delinquency behind whichever entry happened to be healthy.
    const d = derivePlan({
      id: "c",
      subscriptions: [
        entry({ plan_id: "extra" }),
        entry({ plan_id: "pro", past_due: true }),
      ],
    } as never);
    expect(d.anyPastDue).toBe(true);
    expect(d.plan?.planStatus).toBe("past_due");
  });

  it("ignores add-ons, expired and scheduled entries", () => {
    const d = derivePlan({
      id: "c",
      subscriptions: [
        entry({ plan_id: "addon", add_on: true, past_due: true }),
        entry({ plan_id: "old", status: "expired", past_due: true }),
        entry({ plan_id: "next", status: "scheduled", past_due: true }),
        entry({ plan_id: "pro" }),
      ],
    } as never);
    expect(d.anyPastDue).toBe(false);
    expect(d.plan?.planId).toBe("pro");
  });

  it("prefers a paid plan over the auto-attached free plan", () => {
    const d = derivePlan({
      id: "c",
      subscriptions: [entry({ plan_id: "free" }), entry({ status: "trialing" })],
    } as never);
    expect(d.plan?.planId).toBe("pro");
  });

  it("reports productsMissing for an empty response", () => {
    const d = derivePlan({ id: "c" } as never);
    expect(d).toEqual({
      plan: undefined,
      anyPastDue: false,
      productsMissing: true,
    });
  });

  it("reports no plan — but not productsMissing — when all plans expired", () => {
    // Autumn answered definitively: the customer holds nothing. The overdue
    // state must still be allowed to clear, so this is NOT productsMissing.
    const d = derivePlan({
      id: "c",
      subscriptions: [entry({ status: "expired" })],
    } as never);
    expect(d.plan).toBeUndefined();
    expect(d.productsMissing).toBe(false);
  });

  it("reads the legacy products[] shape when subscriptions are absent", () => {
    const d = derivePlan({
      id: "c",
      products: [{ id: "pro", status: "past_due", is_add_on: false }],
    } as never);
    expect(d.anyPastDue).toBe(true);
    expect(d.plan?.planId).toBe("pro");
  });
});

describe("usage — findPayableInvoiceUrl", () => {
  const inv = (over: Record<string, unknown>) => ({
    status: "open",
    hosted_invoice_url: "https://invoice.stripe.com/x",
    created_at: 1,
    ...over,
  });

  it("picks the newest unpaid invoice", () => {
    expect(
      findPayableInvoiceUrl({
        id: "c",
        invoices: [
          inv({ created_at: 1, hosted_invoice_url: "old" }),
          inv({ created_at: 5, hosted_invoice_url: "new" }),
        ],
      } as never),
    ).toBe("new");
  });

  it("ignores paid, void and draft invoices", () => {
    for (const status of ["paid", "void", "draft"]) {
      expect(
        findPayableInvoiceUrl({ id: "c", invoices: [inv({ status })] } as never),
      ).toBeUndefined();
    }
  });

  it("ignores unpaid invoices with no hosted page", () => {
    expect(
      findPayableInvoiceUrl({
        id: "c",
        invoices: [inv({ hosted_invoice_url: null })],
      } as never),
    ).toBeUndefined();
  });

  it("returns undefined when invoices were not expanded", () => {
    expect(findPayableInvoiceUrl({ id: "c" } as never)).toBeUndefined();
  });
});

describe("usage — pastDueSince lifecycle in syncAllFeatures", () => {
  it("sets pastDueSince when a plan first goes past_due", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "active");
    expect((await getQuotaDoc(t))?.pastDueSince).toBeUndefined();

    const before = Date.now();
    await sync(t, "past_due");
    const doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("past_due");
    expect(doc?.pastDueSince).toBeGreaterThanOrEqual(before);
  });

  it("keeps the original pastDueSince across repeated past_due syncs", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    const first = (await getQuotaDoc(t))?.pastDueSince;
    expect(first).toBeDefined();

    await sync(t, "past_due");
    expect((await getQuotaDoc(t))?.pastDueSince).toBe(first);
  });

  it("clears pastDueSince when the plan recovers", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    expect((await getQuotaDoc(t))?.pastDueSince).toBeDefined();

    await sync(t, "active");
    const doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("active");
    expect(doc?.pastDueSince).toBeUndefined();
  });

  it("clears pastDueSince when the customer drops to no plan at all", async () => {
    // Cancelling while past due lands the customer on Free immediately, so
    // they must come out of the blocked state rather than stay stuck on a
    // stale planStatus.
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    expect((await getQuotaDoc(t))?.pastDueSince).toBeDefined();

    await sync(t, undefined, { anyPastDue: false });
    expect((await getQuotaDoc(t))?.pastDueSince).toBeUndefined();
  });

  it("leaves everything untouched when Autumn returned no products", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    const first = (await getQuotaDoc(t))?.pastDueSince;

    await sync(t, undefined, { productsMissing: true, anyPastDue: false });
    const doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("past_due");
    expect(doc?.pastDueSince).toBe(first);
  });

  it("does not auto-archive courses while past due", async () => {
    const t = convexTest(schema, modules);
    const courseIds = await t.run(async (ctx) => {
      const base = {
        userId: "user_A",
        baseLanguages: ["en"],
        isArchived: false,
      };
      return [
        await ctx.db.insert("courses", { ...base, targetLanguages: ["de"] }),
        await ctx.db.insert("courses", { ...base, targetLanguages: ["es"] }),
      ];
    });

    // Entitlements revoked during dunning: courses.included drops to 1 while
    // the user holds 2. Archiving here would be unrecoverable by paying.
    await t.mutation(internal.usage.helpers.syncAllFeatures, {
      userId: "user_A",
      features: { ...FEATURES, courses: { balance: 0, included: 1, used: 1 } },
      anyPastDue: true,
      productsMissing: false,
      planId: "pro",
      planName: "Pro",
      planStatus: "past_due",
    });

    const archived = await t.run(async (ctx) => {
      const docs = await Promise.all(courseIds.map((id) => ctx.db.get(id)));
      return docs.filter((d) => d?.isArchived).length;
    });
    expect(archived).toBe(0);
  });

  it("does not auto-archive on a productsMissing sync while still blocked", async () => {
    // The gap the `anyPastDue` flag alone leaves open: a productsMissing
    // reply carries anyPastDue:false (Autumn told us nothing), yet it
    // deliberately preserves pastDueSince — so the user is still hard-blocked
    // while the incoming flag reads healthy. Archiving on that flag would
    // destroy courses during the exact window the guard exists for, and
    // paying the invoice would not bring them back.
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    const courseIds = await seedCourses(t, 2);

    await t.mutation(internal.usage.helpers.syncAllFeatures, {
      userId: "user_A",
      features: withCourses({ balance: 0, included: 1, used: 1 }),
      anyPastDue: false,
      productsMissing: true,
    });

    const docs = await readCourses(t, courseIds);
    expect(docs.filter((d) => d?.isArchived).length).toBe(0);
    // Still blocked, so the archival is only deferred — not skipped forever.
    expect((await getQuotaDoc(t))?.pastDueSince).toBeDefined();
  });
});

describe("usage — course auto-archival on healthy downgrade", () => {
  it("archives exactly the excess, sparing the active course", async () => {
    // A downgrade must actually shrink the account to what is being paid
    // for — but archiving the course the user is currently studying would
    // yank the app out from under them mid-session. `archivedAt` matters
    // beyond bookkeeping: it drives the 30-day unarchive cooldown, so a
    // missing stamp would let the slice be gamed via archive/unarchive churn.
    const t = convexTest(schema, modules);
    const ids = await seedCourses(t, 3, { activeIndex: 1 });

    await sync(t, "active", {
      features: withCourses({ balance: 0, included: 1, used: 1 }),
    });

    const docs = await readCourses(t, ids);
    expect(docs.filter((d) => d?.isArchived === true)).toHaveLength(2);
    expect(docs[1]?.isArchived).toBe(false);
    expect(docs[1]?.archivedAt).toBeUndefined();
    for (const d of [docs[0], docs[2]]) {
      expect(d?.isArchived).toBe(true);
      expect(typeof d?.archivedAt).toBe("number");
    }
  });

  it("protects the active course even when it would otherwise be excess", async () => {
    // The unprotected slice archives the oldest courses first. If the user's
    // active course IS the oldest, protection must shift the archival onto a
    // sibling rather than silently deactivating what they are studying —
    // otherwise a plan change looks like data loss in the middle of a lesson.
    const t = convexTest(schema, modules);
    const ids = await seedCourses(t, 3, { activeIndex: 0 });

    await sync(t, "active", {
      features: withCourses({ balance: 0, included: 1, used: 1 }),
    });

    const docs = await readCourses(t, ids);
    expect(docs[0]?.isArchived).toBe(false);
    expect(docs[1]?.isArchived).toBe(true);
    expect(docs[2]?.isArchived).toBe(true);
  });

  it("applies the deferred archival on the first healthy sync after dunning", async () => {
    // During dunning the archival is deferred so that paying the invoice
    // restores everything. But the deferral must not become permanent: once
    // billing recovers onto a smaller entitlement, the very next sync has to
    // collect — otherwise a lapsed subscriber keeps paid-tier course slots
    // forever just because the revocation happened to arrive while past due.
    const t = convexTest(schema, modules);
    const ids = await seedCourses(t, 2);

    await sync(t, "past_due", {
      features: withCourses({ balance: 0, included: 1, used: 1 }),
    });
    let docs = await readCourses(t, ids);
    expect(docs.filter((d) => d?.isArchived === true)).toHaveLength(0);

    await sync(t, "active", {
      features: withCourses({ balance: 0, included: 1, used: 1 }),
    });
    docs = await readCourses(t, ids);
    const archived = docs.filter((d) => d?.isArchived === true);
    expect(archived).toHaveLength(1);
    expect(typeof archived[0]?.archivedAt).toBe("number");
  });
});

describe("usage — pastDueInvoiceUrl lifecycle in syncAllFeatures", () => {
  it("keeps the last known URL across non-expanded syncs, clears on recovery", async () => {
    // The hosted invoice page is the only CTA that actually settles the
    // debt (the billing portal just swaps cards). Most syncs don't pay for
    // ?expand=invoices, so a sync without the URL must not blank the pay
    // button while still overdue — but a recovered customer must never be
    // pointed at a stale invoice they no longer owe.
    const t = convexTest(schema, modules);
    await sync(t, "past_due", { pastDueInvoiceUrl: "X" });
    expect((await getQuotaDoc(t))?.pastDueInvoiceUrl).toBe("X");

    await sync(t, "past_due");
    expect((await getQuotaDoc(t))?.pastDueInvoiceUrl).toBe("X");

    await sync(t, "active");
    expect((await getQuotaDoc(t))?.pastDueInvoiceUrl).toBeUndefined();
  });
});

describe("usage — server-side payment gate", () => {
  it("consumeQuota throws PAYMENT_PAST_DUE while past due", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    await expect(
      t.run(async (ctx) => {
        const { consumeQuota } = await import("../../usage/helpers");
        return consumeQuota(ctx as never, "user_A", "chat_messages", 1);
      }),
    ).rejects.toThrow(/PAYMENT_PAST_DUE|Access is paused/);
  });

  it("consumeQuota succeeds once billing is healthy again", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    await sync(t, "active");
    const result = await t.run(async (ctx) => {
      const { consumeQuota } = await import("../../usage/helpers");
      return consumeQuota(ctx as never, "user_A", "chat_messages", 1);
    });
    expect(result.balance).toBe(9);
  });

  it("releaseQuota still refunds while past due", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    const result = await t.run(async (ctx) => {
      const { releaseQuota } = await import("../../usage/helpers");
      return releaseQuota(ctx as never, "user_A", "chat_messages", 1);
    });
    expect(result.balance).toBe(11);
  });
});

describe("usage — quota used-clamp and sync-guard errors", () => {
  it("consumeQuota reports QUOTA_NOT_SYNCED before any sync has run", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        const { consumeQuota } = await import("../../usage/helpers");
        return consumeQuota(ctx as never, "user_A", "chat_messages", 1);
      }),
    ).rejects.toThrow(/QUOTA_NOT_SYNCED/);
  });

  it("releaseQuota throws the no-doc error before any sync has run", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        const { releaseQuota } = await import("../../usage/helpers");
        return releaseQuota(ctx as never, "user_A", "chat_messages", 1);
      }),
    ).rejects.toThrow(/No quota doc for user/);
  });

  it("releaseQuota throws the no-entry error for a feature missing from the doc", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "active");
    await expect(
      t.run(async (ctx) => {
        const { releaseQuota } = await import("../../usage/helpers");
        return releaseQuota(ctx as never, "user_A", "courses", 1);
      }),
    ).rejects.toThrow(/No quota entry for feature "courses"/);
  });

  it("a release larger than used clamps used to 0 while still crediting balance", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "active");
    await t.run(async (ctx) => {
      const { consumeQuota } = await import("../../usage/helpers");
      return consumeQuota(ctx as never, "user_A", "chat_messages", 1);
    });
    let doc = await getQuotaDoc(t);
    expect(doc?.features.chat_messages?.balance).toBe(9);
    expect(doc?.features.chat_messages?.used).toBe(1);

    const result = await t.run(async (ctx) => {
      const { releaseQuota } = await import("../../usage/helpers");
      return releaseQuota(ctx as never, "user_A", "chat_messages", 3);
    });
    expect(result.balance).toBe(12);
    doc = await getQuotaDoc(t);
    expect(doc?.features.chat_messages?.balance).toBe(12);
    expect(doc?.features.chat_messages?.used).toBe(0);
  });

  it("an in-range release decrements used without clamping", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "active");
    await t.run(async (ctx) => {
      const { consumeQuota } = await import("../../usage/helpers");
      return consumeQuota(ctx as never, "user_A", "chat_messages", 2);
    });
    const result = await t.run(async (ctx) => {
      const { releaseQuota } = await import("../../usage/helpers");
      return releaseQuota(ctx as never, "user_A", "chat_messages", 1);
    });
    expect(result.balance).toBe(9);
    const doc = await getQuotaDoc(t);
    expect(doc?.features.chat_messages?.balance).toBe(9);
    expect(doc?.features.chat_messages?.used).toBe(1);
  });
});

describe("usage — getMyQuotas billing fields", () => {
  it("exposes pastDue and pastDueSince when overdue", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "past_due");
    const asUser = t.withIdentity({ subject: "user_A" });
    const quotas = await asUser.query(api.usage.queries.getMyQuotas, {});
    expect(quotas?.pastDue).toBe(true);
    expect(quotas?.planStatus).toBe("past_due");
    expect(quotas?.pastDueSince).toBeDefined();
    // Features contract unchanged.
    expect(quotas?.features.chat_messages?.balance).toBe(10);
  });

  it("reports pastDue false when not overdue", async () => {
    const t = convexTest(schema, modules);
    await sync(t, "active");
    const asUser = t.withIdentity({ subject: "user_A" });
    const quotas = await asUser.query(api.usage.queries.getMyQuotas, {});
    expect(quotas?.pastDue).toBe(false);
    expect(quotas?.planStatus).toBe("active");
    expect(quotas?.pastDueSince).toBeUndefined();
  });

  it("exposes the live course count and invoice URL while overdue", async () => {
    // The cancel confirmation warns "N courses will be archived" — counting
    // an already-archived course would overstate the loss and scare users
    // out of a legitimate cancel; undercounting would understate real data
    // loss. And without the invoice URL the dialog's pay CTA has nowhere to
    // send the user that actually settles the debt.
    const t = convexTest(schema, modules);
    const ids = await seedCourses(t, 3);
    await t.run(async (ctx) => {
      await ctx.db.insert("courses", {
        userId: "user_A",
        baseLanguages: ["en"],
        targetLanguages: ["fr"],
        isArchived: true,
        archivedAt: Date.now(),
      });
    });
    expect(ids).toHaveLength(3);

    await sync(t, "past_due", { pastDueInvoiceUrl: "X" });
    const asUser = t.withIdentity({ subject: "user_A" });
    const quotas = await asUser.query(api.usage.queries.getMyQuotas, {});
    expect(quotas?.pastDue).toBe(true);
    expect(quotas?.activeCourseCount).toBe(3);
    expect(quotas?.pastDueInvoiceUrl).toBe("X");
  });

  it("skips the course count on the healthy path", async () => {
    // Deliberate: activeCourseCount only feeds the cancel-flow warning, so
    // the healthy path returns 0 rather than paying an extra table read on
    // every quota subscription. Pinned so nobody starts treating it as a
    // general-purpose course counter.
    const t = convexTest(schema, modules);
    await seedCourses(t, 3);
    await sync(t, "active");
    const asUser = t.withIdentity({ subject: "user_A" });
    const quotas = await asUser.query(api.usage.queries.getMyQuotas, {});
    expect(quotas?.pastDue).toBe(false);
    expect(quotas?.activeCourseCount).toBe(0);
    expect(quotas?.pastDueInvoiceUrl).toBeUndefined();
  });
});

describe("usage — e2e test hooks gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to force past_due on a customer without a paid plan", async () => {
    // The free plan is auto-attached and has no payment that can fail, so
    // free+past_due cannot occur in production and must not be fakeable.
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("userProfiles", {
        userId: "user_A",
        email: "someone@flexling.com",
        name: "Someone",
        createdAt: Date.now(),
        searchText: "someone@flexling.com someone",
      });
    });
    await t.mutation(internal.usage.helpers.syncAllFeatures, {
      userId: "user_A",
      features: FEATURES,
      anyPastDue: false,
      productsMissing: false,
      planId: "free",
      planName: "Free",
      planStatus: "active",
    });

    await expect(
      t.mutation(internal.usage.testing.setBillingOverride, {
        email: "someone@flexling.com",
        planStatus: "past_due",
      }),
    ).rejects.toThrow(/no paid plan/i);
  });

  it("setBillingOverride throws when E2E_TEST_HOOKS is not set", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.usage.testing.setBillingOverride, {
        email: "someone@flexling.com",
        planStatus: "past_due",
      }),
    ).rejects.toThrow(/test hooks are disabled/);
  });

  it("syncAllFeatures applies an active billing override", async () => {
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("billingTestOverrides", {
        userId: "user_A",
        planStatus: "past_due",
      });
    });
    // Real Autumn state is healthy — the override must win and keep
    // winning across repeated syncs (this is what makes reloads safe).
    await sync(t, "active");
    let doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("past_due");
    expect(doc?.pastDueSince).toBeDefined();
    const firstSeen = doc?.pastDueSince;

    await sync(t, "active");
    doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("past_due");
    expect(doc?.pastDueSince).toBe(firstSeen);
  });

  it("applies the override even when Autumn named no plan", async () => {
    // The old `planId !== undefined` guard skipped the override in exactly
    // the empty-plan case, which is one of the states the e2e drives.
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("billingTestOverrides", {
        userId: "user_A",
        planStatus: "past_due",
      });
    });
    await sync(t, undefined);
    expect((await getQuotaDoc(t))?.pastDueSince).toBeDefined();
  });

  it("syncAllFeatures ignores override rows when hooks are disabled", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("billingTestOverrides", {
        userId: "user_A",
        planStatus: "past_due",
      });
    });
    await sync(t, "active");
    expect((await getQuotaDoc(t))?.planStatus).toBe("active");
  });

  it("set/clearBillingOverride round-trip patches the quota doc", async () => {
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("userProfiles", {
        userId: "user_A",
        email: "someone@flexling.com",
        name: "Someone",
        createdAt: Date.now(),
        searchText: "someone@flexling.com someone",
      });
    });
    await sync(t, "active");

    // Mixed case exercises the email normalization in requireUserIdByEmail.
    await t.mutation(internal.usage.testing.setBillingOverride, {
      email: "Someone@flexling.com",
      planStatus: "past_due",
    });
    let doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("past_due");
    expect(doc?.pastDueSince).toBeDefined();

    await t.mutation(internal.usage.testing.clearBillingOverride, {
      email: "someone@flexling.com",
    });
    doc = await getQuotaDoc(t);
    expect(doc?.planStatus).toBe("active");
    expect(doc?.pastDueSince).toBeUndefined();
    // Override row gone → a later sync stays healthy.
    await sync(t, "active");
    expect((await getQuotaDoc(t))?.planStatus).toBe("active");
  });
});

describe("usage — chargeExtraChatCredits past-due exemption", () => {
  beforeEach(() => {
    // The charge schedules the REAL trackUsage, whose post-track sync would
    // overwrite the features record with the stub's empty payload — racing
    // the balance assertions below. Failing the GET /customers leg makes
    // that job a deterministic no-op after the (harmless) POST /track.
    fetchMock.mockImplementation(async (...args: unknown[]) =>
      String(args[0]).includes("/customers")
        ? {
          ok: false,
          status: 500,
          text: async () => "stubbed failure",
          json: async () => ({}),
        }
        : okResponse(),
    );
  });

  afterEach(() => {
    fetchMock.mockImplementation(async () => okResponse());
  });

  it("still charges the post-generation remainder while blocked", async () => {
    // By the time this runs the LLM cost is already incurred. Gating it
    // behind the past-due block would hand delinquent users free chat
    // completions; instead the ledger stays honest — the balance may go
    // negative and block the NEXT message (mirrors the releaseQuota
    // exemption above).
    const t = convexTest(schema, modules);
    await sync(t, "past_due", {
      features: {
        ...FEATURES,
        credits: { balance: 10, included: 10, used: 0 },
      },
    });
    expect((await getQuotaDoc(t))?.pastDueSince).toBeDefined();

    await t.mutation(internal.usage.helpers.chargeExtraChatCredits, {
      userId: "user_A",
      extraMessageUnits: 2,
    });

    const doc = await getQuotaDoc(t);
    // chat_messages is credit-backed, so the charge draws from the shared
    // credits pool and leaves the per-feature mirror alone.
    expect(doc?.features.credits?.balance).toBe(8);
    expect(doc?.features.credits?.used).toBe(2);
    expect(doc?.features.chat_messages?.balance).toBe(10);
  });
});

describe("usage — resubscribe after auto-archival", () => {
  it("lets a resubscribed multi-course plan unarchive immediately", async () => {
    // The churn round-trip that must not look like data loss: downgrade
    // auto-archives a course, the user pays for a bigger plan again, and the
    // archived course has to come back at once — multi-course plans skip the
    // 30-day cooldown by design, so quota is the only gate.
    const t = convexTest(schema, modules);
    const ids = await seedCourses(t, 2);

    await sync(t, "active", {
      features: withCourses({ balance: 0, included: 1, used: 1 }),
    });
    let docs = await readCourses(t, ids);
    const archivedId = docs.find((d) => d?.isArchived === true)?._id;
    expect(archivedId).toBeDefined();

    // Resubscribe: Autumn grants 3 course slots again.
    await sync(t, "active", {
      features: withCourses({ balance: 2, included: 3, used: 1 }),
    });

    const asUser = t.withIdentity({ subject: "user_A" });
    const result = await asUser.mutation(api.features.courses.unarchiveCourse, {
      courseId: archivedId!,
    });
    expect(result).toEqual({ status: "success" });

    docs = await readCourses(t, ids);
    const restored = docs.find((d) => d?._id === archivedId);
    expect(restored?.isArchived).toBeUndefined();
    expect(restored?.archivedAt).toBeUndefined();
  });

  it("pins: sync-archived courses hit the cooldown on single-course plans", async () => {
    // Current behavior, pinned deliberately: the 30-day cooldown was built
    // as anti-churn for USER-initiated archives, but the auto-archival sync
    // stamps the same `archivedAt`. On a plan with included <= 1 the user
    // therefore cannot swap TO the course the downgrade archived FOR them
    // for 30 days — even with a free slot, as here. If that's not intended,
    // the sync needs to mark its own archives; reported as a source issue.
    const t = convexTest(schema, modules);
    const ids = await seedCourses(t, 2);

    await sync(t, "active", {
      features: withCourses({ balance: 0, included: 1, used: 1 }),
    });
    const docs = await readCourses(t, ids);
    const archived = docs.find((d) => d?.isArchived === true);
    expect(archived).toBeDefined();

    // Free the slot (still a single-course plan) so the cooldown — not
    // quota — is provably what blocks the unarchive.
    await sync(t, "active", {
      features: withCourses({ balance: 1, included: 1, used: 0 }),
    });

    const asUser = t.withIdentity({ subject: "user_A" });
    const result = await asUser.mutation(api.features.courses.unarchiveCourse, {
      courseId: archived!._id,
    });
    expect(result).toEqual({
      status: "cooldown",
      readyAt: archived!.archivedAt! + ARCHIVE_COOLDOWN_MS,
    });
  });
});
