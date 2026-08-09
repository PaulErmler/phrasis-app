import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const useUIMessagesMock = vi.fn().mockReturnValue({
  status: "CanLoadMore",
  results: [],
});
const sendMutation = vi.fn();
const transcribeAction = vi.fn();

vi.mock("@convex-dev/agent/react", () => ({
  useUIMessages: (...args: unknown[]) => useUIMessagesMock(...args),
}));

vi.mock("convex/react", () => ({
  useMutation: () => sendMutation,
  useAction: () => transcribeAction,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useChat } from "@/hooks/use-chat";

describe("useChat", () => {
  beforeEach(() => {
    sendMutation.mockReset();
    transcribeAction.mockReset();
  });

  it("has initial empty text and ready status", () => {
    const { result } = renderHook(() => useChat({ threadId: "t1" }));
    expect(result.current.text).toBe("");
    expect(result.current.voice.isRecording).toBe(false);
  });

  it("setText updates text", () => {
    const { result } = renderHook(() => useChat({ threadId: "t1" }));
    act(() => result.current.setText("hello"));
    expect(result.current.text).toBe("hello");
  });

  it("sendMessage no-ops when empty", async () => {
    const { result } = renderHook(() => useChat({ threadId: "t1" }));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(sendMutation).not.toHaveBeenCalled();
  });

  it("sendMessage calls mutation with text", async () => {
    sendMutation.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChat({ threadId: "tX" }));
    act(() => result.current.setText("yo"));
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(sendMutation).toHaveBeenCalled();
  });

  it("sendQuickAction sends the label as prompt with the action attached", async () => {
    sendMutation.mockResolvedValue(undefined);
    const { result } = renderHook(() => useChat({ threadId: "tX" }));
    await act(async () => {
      await result.current.sendQuickAction(
        { kind: "synonyms", word: "Hund", language: "de" },
        "Synonyms of Hund",
      );
    });
    expect(sendMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Synonyms of Hund",
        quickAction: { kind: "synonyms", word: "Hund", language: "de" },
      }),
    );
  });

  it("sendQuickAction no-ops on an empty label", async () => {
    const { result } = renderHook(() => useChat({ threadId: "tX" }));
    await act(async () => {
      await result.current.sendQuickAction({ kind: "grammar" }, "  ");
    });
    expect(sendMutation).not.toHaveBeenCalled();
  });
});
