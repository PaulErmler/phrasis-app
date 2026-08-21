import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ConvexError } from "convex/values";

const mutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => mutationMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";
import { useSendMessage } from "@/hooks/use-send-message";
import { CHAT_STATUS, ERROR_MESSAGES } from "@/lib/constants/chat";

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

  it("forwards quickAction to the mutation", async () => {
    mutationMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSendMessage({ threadId: "t1" }));
    await act(async () => {
      await result.current.sendMessage({
        prompt: "Grammar",
        quickAction: { kind: "grammar" },
      });
    });
    expect(mutationMock).toHaveBeenCalledWith({
      threadId: "t1",
      prompt: "Grammar",
      cardId: undefined,
      quickAction: { kind: "grammar" },
    });
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

describe("useSendMessage payment-overdue handling", () => {
  beforeEach(() => {
    mutationMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("swallows PAYMENT_PAST_DUE silently and returns the chat to ready", async () => {
    // The blocking payment-overdue dialog is already on screen when this
    // rejection arrives; an error toast or the usage-limit upsell on top of
    // it would double-punish a paying-but-lapsed customer and steer them
    // toward the wrong fix (buying more credits instead of settling the
    // invoice). The only acceptable side effect is unfreezing the composer.
    mutationMock.mockRejectedValue(
      new ConvexError({ code: "PAYMENT_PAST_DUE", message: "payment past due" }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const setStatus = vi.fn();
    const onUsageLimit = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", setStatus, onUsageLimit, onError }),
    );

    // Must resolve. A rethrow here would surface as an unhandled rejection
    // in callers that fire-and-forget sendMessage.
    await act(async () => {
      await expect(
        result.current.sendMessage({ prompt: "hi" }),
      ).resolves.toBeUndefined();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(onUsageLimit).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    // submitted -> ready, never the error status (the error status flashes a
    // red composer, which would read as "the app broke", not "payment due").
    expect(setStatus.mock.calls).toEqual([
      [CHAT_STATUS.SUBMITTED],
      [CHAT_STATUS.READY],
    ]);
    consoleError.mockRestore();
  });

  it("still routes USAGE_LIMIT to onUsageLimit with the feature id", async () => {
    // Contrast case: quota exhaustion is recoverable by upgrading, so the
    // upsell callback must keep firing. The past-due swallow above must not
    // widen into eating every billing-shaped error.
    mutationMock.mockRejectedValue(
      new ConvexError({ code: "USAGE_LIMIT", featureId: "chat_messages" }),
    );
    const setStatus = vi.fn();
    const onUsageLimit = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", setStatus, onUsageLimit }),
    );

    await act(async () => {
      await expect(
        result.current.sendMessage({ prompt: "hi" }),
      ).resolves.toBeUndefined();
    });

    expect(onUsageLimit).toHaveBeenCalledWith("chat_messages");
    expect(toast.error).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith(CHAT_STATUS.READY);
  });

  it("keeps the generic failure surface for plain errors", async () => {
    // Contrast case: a network blip must stay loud (toast + error flash +
    // rethrow) or users lose messages without ever knowing the send failed.
    vi.useFakeTimers();
    mutationMock.mockRejectedValue(new Error("boom"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const setStatus = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSendMessage({ threadId: "t", setStatus, onError }),
    );

    await act(async () => {
      await expect(
        result.current.sendMessage({ prompt: "hi" }),
      ).rejects.toThrow("boom");
    });

    expect(toast.error).toHaveBeenCalledWith(ERROR_MESSAGES.FAILED_TO_SEND);
    expect(onError).toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith(CHAT_STATUS.ERROR);

    // The error flash self-heals so the composer isn't dead-ended.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(setStatus).toHaveBeenLastCalledWith(CHAT_STATUS.READY);
    consoleError.mockRestore();
  });
});
