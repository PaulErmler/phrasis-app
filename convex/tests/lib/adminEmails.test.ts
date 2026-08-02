import { describe, it, expect, vi, afterEach } from "vitest";
import { sendAdminNotificationEmail } from "../../lib/adminEmails";
import type { AuthEmailCtx } from "../../lib/authEmails";
import { describePlanChange } from "../../usage/helpers";

describe("sendAdminNotificationEmail", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is skipped entirely in E2E capture mode", async () => {
    vi.stubEnv("E2E_TEST_HOOKS", "1");
    // A ctx that would throw on any use — proves nothing is called.
    const ctx = new Proxy(
      {},
      {
        get() {
          throw new Error("ctx must not be touched in capture mode");
        },
      },
    ) as AuthEmailCtx;
    await expect(
      sendAdminNotificationEmail(ctx, { subject: "x", lines: ["y"] }),
    ).resolves.toBeUndefined();
  });

  it("never throws when the send fails (best-effort)", async () => {
    const ctx = {
      runMutation: vi.fn(async () => {
        throw new Error("resend down");
      }),
    } as unknown as AuthEmailCtx;
    await expect(
      sendAdminNotificationEmail(ctx, { subject: "x", lines: ["y"] }),
    ).resolves.toBeUndefined();
  });
});

describe("describePlanChange", () => {
  const free = { plan_id: "free", plan_name: "Free", plan_status: "active" };
  const pro = { plan_id: "pro", plan_name: "Pro", plan_status: "active" };
  const proTrial = { ...pro, plan_status: "trialing" };
  const proYearly = {
    plan_id: "pro_yearly",
    plan_name: "Pro Yearly",
    plan_status: "active",
  };

  it("classifies free → paid as subscription (or trial)", () => {
    expect(describePlanChange(free, pro)).toBe("New subscription");
    expect(describePlanChange(free, proTrial)).toBe("Trial started");
  });

  it("classifies paid → free as cancellation", () => {
    expect(describePlanChange(pro, free)).toBe("Subscription cancelled");
    // Plan expired entirely (no plan reported) counts as cancelled too.
    expect(describePlanChange(pro, {})).toBe("Subscription cancelled");
  });

  it("classifies paid → other paid as plan change", () => {
    expect(describePlanChange(pro, proYearly)).toBe("Plan changed");
  });

  it("classifies same-plan status flips as status change", () => {
    expect(describePlanChange(proTrial, pro)).toBe("Plan status changed");
    expect(
      describePlanChange(pro, { ...pro, plan_status: "past_due" }),
    ).toBe("Plan status changed");
  });
});
