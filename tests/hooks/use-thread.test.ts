import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ConvexError } from 'convex/values';

const harness = vi.hoisted(() => ({
  mutationMock: vi.fn(),
  auth: { isAuthenticated: true },
}));
const { mutationMock } = harness;

vi.mock('convex/react', () => ({
  useMutation: () => harness.mutationMock,
  useConvexAuth: () => harness.auth,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useThread } from '@/hooks/use-thread';
import { toast } from 'sonner';

describe('useThread', () => {
  beforeEach(() => {
    mutationMock.mockReset();
    vi.mocked(toast.error).mockReset();
    harness.auth = { isAuthenticated: true };
  });

  it('uses explicit threadId immediately', () => {
    const { result } = renderHook(() => useThread({ threadId: 'abc' }));
    expect(result.current.threadId).toBe('abc');
    expect(result.current.isLoading).toBe(false);
  });

  it('auto-creates a thread when autoCreate is true', async () => {
    mutationMock.mockResolvedValue('new-thread');
    const { result } = renderHook(() => useThread({ autoCreate: true }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.threadId).toBe('new-thread'));
    expect(result.current.isLoading).toBe(false);
  });

  it('handles auto-create failure', async () => {
    mutationMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useThread({ autoCreate: true }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threadId).toBeNull();
  });

  it('getOrCreateEmptyThread sets threadId', async () => {
    mutationMock.mockResolvedValue('made-it');
    const { result } = renderHook(() => useThread());
    await act(async () => {
      const id = await result.current.getOrCreateEmptyThread();
      expect(id).toBe('made-it');
    });
    expect(result.current.threadId).toBe('made-it');
  });

  /**
   * Regression: the app shell mounts before Convex's auth handshake completes,
   * and Convex sends requests unauthenticated rather than queueing them. This
   * effect is one-shot, so firing it early used to mean a permanent
   * "Unauthenticated" rejection (PostHog issue 019fec40) plus an error toast,
   * and no thread for the rest of the session.
   */
  describe('auth gating (regression)', () => {
    it('does not call the mutation while unauthenticated', async () => {
      harness.auth = { isAuthenticated: false };
      mutationMock.mockResolvedValue('new-thread');

      const { result } = renderHook(() => useThread({ autoCreate: true }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(mutationMock).not.toHaveBeenCalled();
      // Still loading, not a failed empty state.
      expect(result.current.isLoading).toBe(true);
      expect(result.current.threadId).toBeNull();
    });

    it('creates the thread once auth lands', async () => {
      harness.auth = { isAuthenticated: false };
      mutationMock.mockResolvedValue('late-thread');

      const { result, rerender } = renderHook(() =>
        useThread({ autoCreate: true }),
      );
      expect(mutationMock).not.toHaveBeenCalled();

      harness.auth = { isAuthenticated: true };
      rerender();

      await waitFor(() => expect(result.current.threadId).toBe('late-thread'));
      expect(mutationMock).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(false);
    });

    it('stays one-shot across re-renders once authenticated', async () => {
      mutationMock.mockResolvedValue('only-once');
      const { result, rerender } = renderHook(() =>
        useThread({ autoCreate: true }),
      );
      await waitFor(() => expect(result.current.threadId).toBe('only-once'));

      rerender();
      rerender();

      expect(mutationMock).toHaveBeenCalledTimes(1);
    });

    it('does not toast when auto-create fails with an auth error', async () => {
      mutationMock.mockRejectedValue(new ConvexError('Unauthenticated'));

      const { result } = renderHook(() => useThread({ autoCreate: true }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('re-arms after an auth-error failure and retries on the next auth recovery', async () => {
      mutationMock.mockRejectedValueOnce(new ConvexError('Unauthenticated'));
      mutationMock.mockResolvedValueOnce('recovered-thread');

      const { result, rerender } = renderHook(() =>
        useThread({ autoCreate: true }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.threadId).toBeNull();

      // Convex notices the rejected token, ClientAuthBoundary confirms the
      // session, auth flips back. The hook must retry, not stay latched.
      harness.auth = { isAuthenticated: false };
      rerender();
      harness.auth = { isAuthenticated: true };
      rerender();

      await waitFor(() =>
        expect(result.current.threadId).toBe('recovered-thread'),
      );
      expect(mutationMock).toHaveBeenCalledTimes(2);
    });

    it('stays latched after a non-auth failure', async () => {
      mutationMock.mockRejectedValue(new Error('boom'));

      const { result, rerender } = renderHook(() =>
        useThread({ autoCreate: true }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      harness.auth = { isAuthenticated: false };
      rerender();
      harness.auth = { isAuthenticated: true };
      rerender();

      await act(async () => {
        await Promise.resolve();
      });
      expect(mutationMock).toHaveBeenCalledTimes(1);
    });

    it('still toasts for non-auth failures', async () => {
      mutationMock.mockRejectedValue(new Error('boom'));

      const { result } = renderHook(() => useThread({ autoCreate: true }));

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('does not toast on auth errors from the manual call, but still rejects', async () => {
      mutationMock.mockRejectedValue(new ConvexError('Unauthenticated'));
      const { result } = renderHook(() => useThread());

      await act(async () => {
        await expect(result.current.getOrCreateEmptyThread()).rejects.toThrow();
      });

      expect(toast.error).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
    });
  });
});
