import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";

const harness = vi.hoisted(() => ({
  mutationMock: vi.fn(),
  auth: { isAuthenticated: true },
}));
const { mutationMock } = harness;

vi.mock("convex/react", () => ({
  useMutation: () => harness.mutationMock,
  useConvexAuth: () => harness.auth,
}));

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(),
}));

import { usePrefetchedThread } from "@/hooks/use-prefetched-thread";
import { reportError } from "@/lib/report-error";

describe("usePrefetchedThread", () => {
  beforeEach(() => {
    mutationMock.mockReset();
    vi.mocked(reportError).mockReset();
    harness.auth = { isAuthenticated: true };
  });

  it("prefetches a thread once authenticated", async () => {
    mutationMock.mockResolvedValue("thread-1");
    const { result } = renderHook(() => usePrefetchedThread());

    await waitFor(() =>
      expect(result.current.prefetchedThreadId).toBe("thread-1"),
    );
    expect(mutationMock).toHaveBeenCalledTimes(1);
  });

  it("refreshPrefetchedThread replaces the cached thread", async () => {
    mutationMock.mockResolvedValueOnce("thread-1");
    const { result } = renderHook(() => usePrefetchedThread());
    await waitFor(() =>
      expect(result.current.prefetchedThreadId).toBe("thread-1"),
    );

    mutationMock.mockResolvedValueOnce("thread-2");
    act(() => result.current.refreshPrefetchedThread());

    await waitFor(() =>
      expect(result.current.prefetchedThreadId).toBe("thread-2"),
    );
    expect(mutationMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression for PostHog issue 019fec40: the app shell mounts before Convex
   * finishes its auth handshake, and Convex sends requests unauthenticated
   * instead of queueing them. The prefetch is one-shot, so an ungated call
   * rejected with "Unauthenticated" and left prefetchedThreadId null for the
   * whole session. Reported as an exception the user could do nothing about.
   */
  describe("auth gating (regression)", () => {
    it("does not prefetch while unauthenticated", async () => {
      harness.auth = { isAuthenticated: false };
      mutationMock.mockResolvedValue("thread-1");

      const { result } = renderHook(() => usePrefetchedThread());

      await act(async () => {
        await Promise.resolve();
      });
      expect(mutationMock).not.toHaveBeenCalled();
      expect(result.current.prefetchedThreadId).toBeNull();
    });

    it("prefetches once auth lands, rather than staying stranded", async () => {
      harness.auth = { isAuthenticated: false };
      mutationMock.mockResolvedValue("thread-late");

      const { result, rerender } = renderHook(() => usePrefetchedThread());
      expect(mutationMock).not.toHaveBeenCalled();

      harness.auth = { isAuthenticated: true };
      rerender();

      await waitFor(() =>
        expect(result.current.prefetchedThreadId).toBe("thread-late"),
      );
      expect(mutationMock).toHaveBeenCalledTimes(1);
    });

    it("re-arms after an auth-error failure and retries on the next auth recovery", async () => {
      mutationMock.mockRejectedValueOnce(new ConvexError("Unauthenticated"));
      mutationMock.mockResolvedValueOnce("thread-after-recovery");

      const { result, rerender } = renderHook(() => usePrefetchedThread());
      await waitFor(() => expect(mutationMock).toHaveBeenCalledTimes(1));
      await act(async () => {
        await Promise.resolve();
      });

      // Convex notices the rejected token, ClientAuthBoundary confirms the
      // session, auth flips back. The prefetch must retry, not stay
      // stranded at null (the exact symptom this hook's gating exists for).
      harness.auth = { isAuthenticated: false };
      rerender();
      harness.auth = { isAuthenticated: true };
      rerender();

      await waitFor(() =>
        expect(result.current.prefetchedThreadId).toBe("thread-after-recovery"),
      );
      expect(mutationMock).toHaveBeenCalledTimes(2);
    });

    it("prefetches only once while authenticated", async () => {
      mutationMock.mockResolvedValue("thread-1");
      const { result, rerender } = renderHook(() => usePrefetchedThread());
      await waitFor(() =>
        expect(result.current.prefetchedThreadId).toBe("thread-1"),
      );

      rerender();
      rerender();

      expect(mutationMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("error reporting", () => {
    it("does not report auth errors to the exception feed", async () => {
      mutationMock.mockRejectedValue(new ConvexError("Unauthenticated"));
      renderHook(() => usePrefetchedThread());

      await waitFor(() => expect(mutationMock).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });

      expect(reportError).not.toHaveBeenCalled();
    });

    it("reports genuine failures", async () => {
      mutationMock.mockRejectedValue(new Error("boom"));
      renderHook(() => usePrefetchedThread());

      await waitFor(() =>
        expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
          op: "prefetchEmptyThread",
        }),
      );
    });
  });
});
