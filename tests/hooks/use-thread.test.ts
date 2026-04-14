import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => mutationMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useThread } from "@/hooks/use-thread";

describe("useThread", () => {
  beforeEach(() => {
    mutationMock.mockReset();
  });

  it("uses explicit threadId immediately", () => {
    const { result } = renderHook(() => useThread({ threadId: "abc" }));
    expect(result.current.threadId).toBe("abc");
    expect(result.current.isLoading).toBe(false);
  });

  it("auto-creates a thread when autoCreate is true", async () => {
    mutationMock.mockResolvedValue("new-thread");
    const { result } = renderHook(() => useThread({ autoCreate: true }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe("new-thread"));
    expect(result.current.isLoading).toBe(false);
  });

  it("handles auto-create failure", async () => {
    mutationMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useThread({ autoCreate: true }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threadId).toBeNull();
  });

  it("getOrCreateEmptyThread sets threadId", async () => {
    mutationMock.mockResolvedValue("made-it");
    const { result } = renderHook(() => useThread());
    await act(async () => {
      const id = await result.current.getOrCreateEmptyThread();
      expect(id).toBe("made-it");
    });
    expect(result.current.threadId).toBe("made-it");
  });
});
