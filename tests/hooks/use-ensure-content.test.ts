import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mutationMock = vi.fn();

vi.mock('convex/react', () => ({
  useMutation: () => mutationMock,
}));

import { useEnsureContent } from '@/hooks/use-ensure-content';

describe('useEnsureContent', () => {
  beforeEach(() => {
    mutationMock.mockReset();
    mutationMock.mockResolvedValue(undefined);
  });

  it('calls mutation for cards with missing content', () => {
    renderHook(() =>
      useEnsureContent([
        { textId: 't1', hasMissingContent: true },
        { textId: 't2', hasMissingContent: false },
      ]),
    );
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(mutationMock).toHaveBeenCalledWith({ textId: 't1' });
  });

  it('skips already-ensured ids', () => {
    renderHook(() =>
      useEnsureContent([{ textId: 't1', hasMissingContent: true }]),
    );
    const initialCalls = mutationMock.mock.calls.length;
    renderHook(() =>
      useEnsureContent([{ textId: 't1', hasMissingContent: true }]),
    );
    // Should not call again for the same textId in the session
    expect(mutationMock.mock.calls.length).toBe(initialCalls);
  });

  it('does nothing when cards is null/undefined', () => {
    mutationMock.mockClear();
    renderHook(() => useEnsureContent(null));
    renderHook(() => useEnsureContent(undefined));
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('limits to batch size of 5', () => {
    mutationMock.mockClear();
    const cards = Array.from({ length: 10 }, (_, i) => ({
      textId: `batch-${i}`,
      hasMissingContent: true,
    }));
    renderHook(() => useEnsureContent(cards));
    expect(mutationMock).toHaveBeenCalledTimes(5);
  });
});
