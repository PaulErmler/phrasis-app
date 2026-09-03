import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const actionMock = vi.fn();

vi.mock('convex/react', () => ({
  useAction: () => actionMock,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useVoiceRecording } from '@/hooks/use-voice-recording';

class FakeMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true);
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = 'audio/webm';
  state = 'inactive';
  constructor(public stream: any) {}
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x']), size: 1 });
    this.onstop?.();
  }
}

describe('useVoiceRecording', () => {
  beforeEach(() => {
    actionMock.mockReset();
    // @ts-expect-error shim
    window.MediaRecorder = FakeMediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
  });

  it('starts and stops recording', async () => {
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue('hello world');
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
      expect(onTranscript).toHaveBeenCalledWith('hello world'),
    );
  });

  it('handles mic permission failure gracefully', async () => {
    (navigator.mediaDevices.getUserMedia as any) = vi
      .fn()
      .mockRejectedValue(new Error('denied'));
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceRecording(onTranscript));
    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(false);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('handleVoiceClick toggles', async () => {
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue('');
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

  it('pins transcription to the language option (writing-mode dictation)', async () => {
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue('hola');
    const { result } = renderHook(() =>
      useVoiceRecording(onTranscript, undefined, { language: 'es' }),
    );
    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
      await Promise.resolve();
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('hola'));
    expect(actionMock).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'es' }),
    );
  });

  it('auto-stops at maxDurationMs and transcribes what was captured', async () => {
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue('timed out answer');
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useVoiceRecording(onTranscript, undefined, { maxDurationMs: 30_000 }),
      );
      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.isRecording).toBe(true);
      // No user stop: the cap fires, the recorder stops, transcription runs.
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await vi.runAllTimersAsync();
      });
      expect(result.current.isRecording).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith('timed out answer'),
    );
  });

  it('claims the transcribing state on stop, leaving no idle gap', async () => {
    // Real browsers fire `onstop` on a LATER task than stop(); the shared
    // fake fires it synchronously, which would paper over the very gap this
    // asserts on.
    class AsyncStopRecorder extends FakeMediaRecorder {
      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['x']), size: 1 });
          this.onstop?.();
        }, 0);
      }
    }
    // @ts-expect-error shim
    window.MediaRecorder = AsyncStopRecorder;

    const onTranscript = vi.fn();
    actionMock.mockResolvedValue('dictated');
    const { result } = renderHook(() => useVoiceRecording(onTranscript));
    await act(async () => {
      await result.current.startRecording();
    });

    // Synchronously after the stop — before `onstop` has run — the hook must
    // already report transcribing. Every consumer disables the button on that
    // flag, so a render with neither flag set is a window in which a second
    // click starts a fresh recording over the one still being transcribed.
    act(() => {
      result.current.stopRecording();
    });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(true);

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('dictated'));
    await waitFor(() => expect(result.current.isTranscribing).toBe(false));
  });

  it('releases the transcribing state when nothing was captured', async () => {
    class SilentRecorder extends FakeMediaRecorder {
      stop() {
        this.state = 'inactive';
        // No `ondataavailable`: the mic yielded nothing at all.
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    // @ts-expect-error shim
    window.MediaRecorder = SilentRecorder;

    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceRecording(onTranscript));
    await act(async () => {
      await result.current.startRecording();
    });
    act(() => {
      result.current.stopRecording();
    });
    expect(result.current.isTranscribing).toBe(true);

    // There is nothing to upload, so the button has to settle back to idle
    // instead of spinning on a transcription that will never start.
    await waitFor(() => expect(result.current.isTranscribing).toBe(false));
    expect(actionMock).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('suppresses the success toast with quiet (writing mode) and keeps it otherwise', async () => {
    const { toast } = await import('sonner');
    vi.mocked(toast.success).mockClear();
    const onTranscript = vi.fn();
    actionMock.mockResolvedValue('first');
    const quietHook = renderHook(() =>
      useVoiceRecording(onTranscript, undefined, { quiet: true }),
    );
    await act(async () => {
      await quietHook.result.current.startRecording();
    });
    await act(async () => {
      quietHook.result.current.stopRecording();
      await Promise.resolve();
    });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('first'));
    expect(toast.success).not.toHaveBeenCalled();

    const loudHook = renderHook(() => useVoiceRecording(onTranscript));
    await act(async () => {
      await loudHook.result.current.startRecording();
    });
    await act(async () => {
      loudHook.result.current.stopRecording();
      await Promise.resolve();
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
