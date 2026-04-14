import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";

const approveMock = vi.fn();
const rejectMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (ref: any) => {
    const name = String(ref);
    if (name.includes("reject")) return rejectMock;
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
});
