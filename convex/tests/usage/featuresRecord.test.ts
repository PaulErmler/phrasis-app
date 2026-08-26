import { describe, it, expect } from "vitest";
import { hasUnpaidInvoice, toFeaturesRecord } from "../../usage/tracking";

/**
 * Direct pins for the two payload readers in usage/tracking.ts that the
 * money paths lean on:
 *
 * - `toFeaturesRecord` is the sole translation from Autumn's customer
 *   payload to the local quota mirror. Every gate (`checkQuota`,
 *   `consumeQuota`, `hasFeatureAccess`) reads what it wrote, so a swapped
 *   field here mis-gates every feature at once. The balances mapping is
 *   covered end-to-end in trackingSync.test.ts; the `flags` (boolean
 *   feature) path and the `unlimited` normalization were not pinned
 *   anywhere.
 * - `hasUnpaidInvoice` is the cancel-after-pay guard's signal in
 *   billing.ts cancelOverdueSubscription: "false" there is what stops the
 *   cancel of a subscription the user just paid for.
 */

describe("toFeaturesRecord", () => {
  it("maps balances remaining/granted/usage onto balance/included/used", () => {
    // Deliberately asymmetric numbers so a swapped mapping cannot cancel
    // out (users would be shown, and gated on, the wrong balance).
    const result = toFeaturesRecord({
      balances: {
        chat_messages: {
          feature_id: "chat_messages",
          granted: 100,
          remaining: 60,
          usage: 40,
          unlimited: false,
        },
      },
    });
    expect(result).toEqual({
      chat_messages: {
        balance: 60,
        included: 100,
        used: 40,
        unlimited: undefined,
      },
    });
  });

  it("normalizes unlimited:false to an absent flag, and preserves unlimited:true", () => {
    const result = toFeaturesRecord({
      balances: {
        metered: {
          feature_id: "metered",
          granted: 10,
          remaining: 10,
          usage: 0,
          unlimited: false,
        },
        firehose: {
          feature_id: "firehose",
          granted: 0,
          remaining: 0,
          usage: 5,
          unlimited: true,
        },
      },
    });
    // `unlimited || undefined`: the stored doc omits the flag rather than
    // persisting `false`. checkQuota treats any truthy flag as "always
    // allowed", so `firehose` must keep it even with a zero balance.
    expect(result.metered.unlimited).toBeUndefined();
    expect(result.firehose.unlimited).toBe(true);
  });

  it("turns boolean features (flags) into unlimited entries — access, not a meter", () => {
    const result = toFeaturesRecord({
      flags: { multiple_languages: {}, ai_feedback: { anything: true } },
    });
    // Only the KEYS carry information; each becomes an always-available
    // feature. Dropping the unlimited flag here would make hasFeatureAccess
    // gate boolean features on a meaningless balance.
    expect(result).toEqual({
      multiple_languages: { balance: 1, included: 1, used: 0, unlimited: true },
      ai_feedback: { balance: 1, included: 1, used: 0, unlimited: true },
    });
  });

  it("returns an empty record for a payload with neither balances nor flags", () => {
    expect(toFeaturesRecord({})).toEqual({});
  });
});

describe("hasUnpaidInvoice", () => {
  it("counts open and uncollectible invoices as unpaid, hosted page or not", () => {
    // "Nothing payable in the dialog" must not read as "nothing owed".
    expect(
      hasUnpaidInvoice({
        invoices: [{ status: "open", hosted_invoice_url: null }],
      }),
    ).toBe(true);
    expect(
      hasUnpaidInvoice({
        invoices: [{ status: "uncollectible", hosted_invoice_url: null }],
      }),
    ).toBe(true);
  });

  it("does not count paid, void or draft invoices", () => {
    // `paid` is the race-free signal that lets cancelOverdueSubscription
    // refuse to cancel a subscription the user settled seconds ago.
    expect(
      hasUnpaidInvoice({
        invoices: [
          { status: "paid", hosted_invoice_url: "https://invoice.stripe.com/i/a" },
          { status: "void" },
          { status: "draft" },
        ],
      }),
    ).toBe(false);
  });

  it("returns false when invoices were not expanded — callers own the 'unknown' reading", () => {
    // The function cannot distinguish "no debt" from "expand not honored";
    // billing.ts guards on Array.isArray(customer.invoices) BEFORE trusting
    // this false. A refactor moving that responsibility in here must
    // consciously change this pin.
    expect(hasUnpaidInvoice({})).toBe(false);
    expect(hasUnpaidInvoice({ invoices: [] })).toBe(false);
  });
});
