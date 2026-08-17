import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";

const approveMock = vi.fn();
const rejectMock = vi.fn();
const replaceMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (ref: any) => {
    const name = String(ref);
    if (name.includes("reject")) return rejectMock;
    if (name.includes("replace")) return replaceMock;
    return approveMock;
  },
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

// Force distinct mutation refs
vi.mock("@/convex/_generated/api", () => ({
  api: {
    features: {
      chat: {
        cardApprovals: {
          approveCard: "approveCard-ref",
          rejectCard: "rejectCard-ref",
          replaceCardFromApproval: "replaceCardFromApproval-ref",
          getApprovalsByThread: "getApprovalsByThread-ref",
        },
      },
    },
  },
}));

import { useCardApprovals } from "@/hooks/use-card-approvals";

describe("useCardApprovals", () => {
  beforeEach(() => {
    approveMock.mockReset();
    rejectMock.mockReset();
    replaceMock.mockReset();
    useQueryMock.mockReset();
  });

  it("returns empty map when no thread", () => {
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useCardApprovals(null));
    expect(result.current.approvalsByToolCallId.size).toBe(0);
    expect(result.current.isLoaded).toBe(false);
  });

  it("builds map from approvals", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "a1",
        toolCallId: "tc1",
        translations: [],
        status: "pending",
      },
    ]);
    const { result } = renderHook(() => useCardApprovals("thread1"));
    expect(result.current.approvalsByToolCallId.get("tc1")?._id).toBe("a1");
    expect(result.current.isLoaded).toBe(true);
  });

  it("approves and tracks processing state", async () => {
    useQueryMock.mockReturnValue([]);
    approveMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCardApprovals("t"));
    await act(async () => {
      await result.current.handleApprove("approval-1" as any);
    });
    expect(approveMock).toHaveBeenCalledWith({ approvalId: "approval-1" });
    expect(result.current.usageLimitHit).toBe(false);
  });

  it("sets usageLimitHit on USAGE_LIMIT error", async () => {
    useQueryMock.mockReturnValue([]);
    approveMock.mockRejectedValue(new ConvexError({ code: "USAGE_LIMIT" }));
    const { result } = renderHook(() => useCardApprovals("t"));
    await act(async () => {
      await result.current.handleApprove("a" as any);
    });
    await waitFor(() => expect(result.current.usageLimitHit).toBe(true));
  });

  it("rejects approval", async () => {
    useQueryMock.mockReturnValue([]);
    rejectMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCardApprovals("t"));
    await act(async () => {
      await result.current.handleReject("rr" as any);
    });
    expect(rejectMock).toHaveBeenCalledWith({ approvalId: "rr" });
  });

  // The result value is the approval boxes' rollback contract: anything but
  // 'success' rolls the optimistic label back, and 'usage_limit' additionally
  // opens the paywall (see useOptimisticApprovalAction in approvalCommon).
  describe("action result taxonomy", () => {
    const cases = [
      { name: "success", setup: undefined, expected: "success" },
      {
        name: "usage_limit on USAGE_LIMIT",
        setup: new ConvexError({ code: "USAGE_LIMIT" }),
        expected: "usage_limit",
      },
      {
        name: "card_replaced on CARD_REPLACED",
        setup: new ConvexError({ code: "CARD_REPLACED" }),
        expected: "card_replaced",
      },
      {
        name: "error on anything else",
        setup: new Error("boom"),
        expected: "error",
      },
    ] as const;

    for (const { name, setup, expected } of cases) {
      it(`approve → ${name}`, async () => {
        useQueryMock.mockReturnValue([]);
        if (setup) approveMock.mockRejectedValue(setup);
        else approveMock.mockResolvedValue(undefined);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { result } = renderHook(() => useCardApprovals("t"));
        let outcome: string | undefined;
        await act(async () => {
          outcome = await result.current.handleApprove("a1" as any);
        });
        expect(outcome).toBe(expected);
      });
    }

    it("reject reports the same taxonomy (it used to swallow errors silently)", async () => {
      useQueryMock.mockReturnValue([]);
      rejectMock.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = renderHook(() => useCardApprovals("t"));
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.handleReject("a1" as any);
      });
      expect(outcome).toBe("error");
    });

    it("a payment-past-due failure reports 'error' without logging (the overdue dialog is the surface)", async () => {
      useQueryMock.mockReturnValue([]);
      approveMock.mockRejectedValue(
        new ConvexError({ code: "PAYMENT_PAST_DUE" }),
      );
      // Re-spying console.error returns the SAME spy the earlier cases used,
      // so clear its accumulated calls before asserting on this one.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      errorSpy.mockClear();
      const { result } = renderHook(() => useCardApprovals("t"));
      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.handleApprove("a1" as any);
      });
      expect(outcome).toBe("error");
      // Silent for THIS failure specifically: no "Failed to approve card" log.
      expect(
        errorSpy.mock.calls.filter((call) =>
          String(call[0]).includes("Failed to"),
        ),
      ).toEqual([]);
      expect(result.current.usageLimitHit).toBe(false);
    });
  });

  describe("handleReplace", () => {
    it("returns the replacement card id on success (Path B re-inserts the card doc)", async () => {
      useQueryMock.mockReturnValue([]);
      replaceMock.mockResolvedValue({ success: true, cardId: "card_new" });
      const { result } = renderHook(() => useCardApprovals("t"));
      let outcome: { result: string; cardId?: string } | undefined;
      await act(async () => {
        outcome = await result.current.handleReplace("a1" as any);
      });
      // The timezone is resolved by the hook, not the caller.
      expect(replaceMock).toHaveBeenCalledWith(
        expect.objectContaining({ approvalId: "a1" }),
      );
      expect(replaceMock.mock.calls[0][0].timezone).toEqual(expect.any(String));
      expect(outcome).toEqual({ result: "success", cardId: "card_new" });
    });

    it("reports card_replaced with NO card id when the target card is gone", async () => {
      useQueryMock.mockReturnValue([]);
      replaceMock.mockRejectedValue(
        new ConvexError({ code: "CARD_REPLACED" }),
      );
      const { result } = renderHook(() => useCardApprovals("t"));
      let outcome: { result: string; cardId?: string } | undefined;
      await act(async () => {
        outcome = await result.current.handleReplace("a1" as any);
      });
      // LearnView suppresses its thread rotation only on `success` + an id;
      // a missing id here must never be mistaken for a replacement.
      expect(outcome).toEqual({ result: "card_replaced", cardId: undefined });
    });

    it("clears the processing flag after the action settles, success or failure", async () => {
      useQueryMock.mockReturnValue([]);
      replaceMock.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = renderHook(() => useCardApprovals("t"));
      await act(async () => {
        await result.current.handleReplace("a1" as any);
      });
      await waitFor(() =>
        expect(result.current.processingApprovals.has("a1")).toBe(false),
      );
    });
  });
});
