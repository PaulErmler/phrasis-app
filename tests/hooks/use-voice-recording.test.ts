import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const actionMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => actionMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useVoiceRecording } from "@/hooks/use-voice-recording";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true);
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state = "inactive";
  constructor(public stream: any) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"]), size: 1 });
    this.onstop?.();
  }
}

describe("useVoiceRecording", () => {
  beforeEach(() => {
    actionMock.mockReset();
    // @ts-expect-error shim
    window.MediaRecorder = FakeMediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
  });

  it("starts and stops recording", async () => {
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue("hello world");
    const { result } = renderHook(() => useVoiceRecording(onTranscript));

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      result.current.stopRecording();
      await Promise.resolve();
    });
    expect(result.current.isRecording).toBe(false);
    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith("hello world"),
    );
  });

  it("handles mic permission failure gracefully", async () => {
    (navigator.mediaDevices.getUserMedia as any) = vi
      .fn()
      .mockRejectedValue(new Error("denied"));
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceRecording(onTranscript));
    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(false);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("handleVoiceClick toggles", async () => {
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue("");
    const { result } = renderHook(() => useVoiceRecording(onTranscript));
    await act(async () => {
      result.current.handleVoiceClick();
    });
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    await act(async () => {
      result.current.handleVoiceClick();
    });
    expect(result.current.isRecording).toBe(false);
  });
});
