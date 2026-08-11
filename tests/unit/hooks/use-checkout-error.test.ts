import { describe, it, expect, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { throwOnCheckoutError } from "@/hooks/use-checkout-error";

/**
 * autumn-js reports failures as a RESOLVED `{ error }` container
 * (wrapSdkCall), so a plain `await checkout(...)` "succeeds" while nothing
 * happened. Every billing entry point routes results through this helper —
 * these pin the container shapes it must and must not treat as failure.
 */
describe("throwOnCheckoutError", () => {
  it("passes through success containers and non-containers", () => {
    expect(() => throwOnCheckoutError({ data: {}, error: null })).not.toThrow();
    expect(() => throwOnCheckoutError({ data: { url: "x" } })).not.toThrow();
    expect(() => throwOnCheckoutError(undefined)).not.toThrow();
    expect(() => throwOnCheckoutError(null)).not.toThrow();
  });

  it("throws the container's message", () => {
    expect(() =>
      throwOnCheckoutError({ data: null, error: { message: "trial gate" } }),
    ).toThrow(/trial gate/);
  });

  it("throws a fallback when the error carries no message", () => {
    expect(() => throwOnCheckoutError({ data: null, error: {} })).toThrow(
      /Checkout failed/,
    );
  });
});
