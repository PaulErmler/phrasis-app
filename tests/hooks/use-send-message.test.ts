import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ConvexError } from "convex/values";

const mutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => mutationMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useSendMessage } from "@/hooks/use-send-message";

describe("useSendMessage", () => {
  beforeEach(() => {
    mutationMock.mockReset();
  });

  it("no-ops on empty prompt", async () => {
    const setStatus = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", setStatus }),
    );
    await act(async () => {
      await result.current.sendMessage({ prompt: "  " });
    });
    expect(mutationMock).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("sends prompt and calls success callback", async () => {
    mutationMock.mockResolvedValue(undefined);
    const setStatus = vi.fn();
    const onSuccess = vi.fn();
    const clearInput = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t1", setStatus, onSuccess }),
    );
    await act(async () => {
      await result.current.sendMessage({ prompt: "hi", clearInput });
    });
    expect(mutationMock).toHaveBeenCalledWith({
      threadId: "t1",
      prompt: "hi",
      cardId: undefined,
    });
    expect(clearInput).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("handles USAGE_LIMIT ConvexError", async () => {
    mutationMock.mockRejectedValue(
      new ConvexError({ code: "USAGE_LIMIT", featureId: "chat" }),
    );
    const onUsageLimit = vi.fn();
    const setStatus = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", onUsageLimit, setStatus }),
    );
    await act(async () => {
      await result.current.sendMessage({ prompt: "hi" });
    });
    expect(onUsageLimit).toHaveBeenCalledWith("chat");
  });

  it("handles THREAD_MESSAGE_LIMIT error", async () => {
    mutationMock.mockRejectedValue(
      new ConvexError({ code: "THREAD_MESSAGE_LIMIT" }),
    );
    const onThreadLimit = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", onThreadLimit }),
    );
    await act(async () => {
      await result.current.sendMessage({ prompt: "hi" });
    });
    expect(onThreadLimit).toHaveBeenCalled();
  });

  it("handles MESSAGE_TOO_LONG error", async () => {
    mutationMock.mockRejectedValue(
      new ConvexError({ code: "MESSAGE_TOO_LONG" }),
    );
    const onMessageTooLong = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", onMessageTooLong }),
    );
    await act(async () => {
      await result.current.sendMessage({ prompt: "hi" });
    });
    expect(onMessageTooLong).toHaveBeenCalled();
  });

  it("rethrows unknown errors after toasting", async () => {
    mutationMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSendMessage({ threadId: "t" }));
    await act(async () => {
      await expect(
        result.current.sendMessage({ prompt: "hi" }),
      ).rejects.toThrow();
    });
  });
});
