import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "@/hooks/use-media-query";

type Listener = (e: MediaQueryListEvent) => void;

function installMatchMedia(matches: boolean) {
  let listener: Listener | null = null;
  const mql = {
    matches,
    addEventListener: (_: string, l: Listener) => {
      listener = l;
    },
    removeEventListener: vi.fn(),
    media: "(min-width: 600px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  window.matchMedia = vi.fn().mockImplementation(() => mql);
  return {
    trigger(next: boolean) {
      mql.matches = next;
      listener?.({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe("useMediaQuery", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  it("returns initial matches", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 600px)"));
    expect(result.current).toBe(true);
  });

  it("updates when media query changes", () => {
    const ctrl = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 600px)"));
    expect(result.current).toBe(false);
    act(() => {
      ctrl.trigger(true);
    });
    expect(result.current).toBe(true);
  });

  it("returns false initially for non-matching query", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 9999px)"));
    expect(result.current).toBe(false);
  });
});
