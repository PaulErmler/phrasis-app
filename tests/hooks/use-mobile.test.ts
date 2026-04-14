import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "@/hooks/use-mobile";

function setup(width: number) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null;
  const mql = {
    matches: width < 768,
    media: "",
    onchange: null,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
      listener = l;
    },
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  // @ts-expect-error test shim
  window.matchMedia = vi.fn().mockReturnValue(mql);
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  return {
    setWidth(w: number) {
      (window as any).innerWidth = w;
      listener?.({} as MediaQueryListEvent);
    },
  };
}

describe("useIsMobile", () => {
  beforeEach(() => {
    setup(1024);
  });

  it("returns false on desktop widths", () => {
    setup(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns true on mobile widths", () => {
    setup(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("updates when width changes", () => {
    const ctrl = setup(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => {
      ctrl.setWidth(400);
    });
    expect(result.current).toBe(true);
  });
});
