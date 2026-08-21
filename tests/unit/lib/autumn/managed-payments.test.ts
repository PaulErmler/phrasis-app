import { describe, it, expect } from "vitest";
import { MANAGED_PAYMENTS_SESSION_PARAMS } from "@/lib/autumn/managed-payments";

/**
 * Managed Payments rides entirely on one opaque passthrough field that ends
 * up inside a hand-written snake_case REST body (convex/billing.ts), so the
 * thing that can silently break it is not a logic bug. It is a shape bug
 * that no type checks. A well-meaning camelCase cleanup would turn
 * merchant-of-record silently off (or into a Stripe 400), and nothing else
 * in the codebase would notice. The full wire bodies are pinned in
 * convex/tests/billing/managedPayments.test.ts; this pins the payload
 * constant itself.
 */
describe("MANAGED_PAYMENTS_SESSION_PARAMS", () => {
  it("exports the exact Stripe payload shape", () => {
    expect(MANAGED_PAYMENTS_SESSION_PARAMS).toEqual({
      managed_payments: { enabled: true },
    });
  });

  it("keeps Stripe's snake_case, camelCase would be rejected downstream", () => {
    expect(Object.keys(MANAGED_PAYMENTS_SESSION_PARAMS)).toEqual([
      "managed_payments",
    ]);
    expect(MANAGED_PAYMENTS_SESSION_PARAMS).not.toHaveProperty(
      "managedPayments",
    );
  });
});
