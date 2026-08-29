import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '@/hooks/use-debounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderDebounce(value: string, delayMs = 300) {
    return renderHook(
      ({ value, delayMs }: { value: string; delayMs: number }) =>
        useDebounce(value, delayMs),
      { initialProps: { value, delayMs } },
    );
  }

  it('returns the initial value immediately', () => {
    const { result } = renderDebounce('a');
    expect(result.current).toBe('a');
  });

  it('holds the previous value until the delay has fully elapsed', () => {
    const { result, rerender } = renderDebounce('a');
    rerender({ value: 'b', delayMs: 300 });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });

  it('restarts the window on every change, so only the settled value lands', () => {
    const { result, rerender } = renderDebounce('a');
    rerender({ value: 'b', delayMs: 300 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'c', delayMs: 300 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 'b' never survived a full window; 'c' has 100ms left.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('c');
  });

  it('re-arms with the new delay when delayMs changes', () => {
    const { result, rerender } = renderDebounce('a', 300);
    rerender({ value: 'b', delayMs: 1000 });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current).toBe('b');
  });
});
