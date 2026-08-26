import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const useUIMessagesMock = vi.fn();

vi.mock('@convex-dev/agent/react', () => ({
  useUIMessages: (...args: unknown[]) => useUIMessagesMock(...args),
}));

import { useChatMessages } from '@/hooks/use-chat-messages';
import { CHAT_STATUS } from '@/lib/constants/chat';

describe('useChatMessages', () => {
  beforeEach(() => {
    useUIMessagesMock.mockReset();
  });

  it('is loading when no result', () => {
    useUIMessagesMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useChatMessages({ threadId: 't' }));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages).toEqual([]);
  });

  it('is loading when first page loading', () => {
    useUIMessagesMock.mockReturnValue({
      status: 'LoadingFirstPage',
      results: [],
    });
    const { result } = renderHook(() => useChatMessages({ threadId: 't' }));
    expect(result.current.isLoading).toBe(true);
  });

  it('exposes messages when loaded', () => {
    useUIMessagesMock.mockReturnValue({
      status: 'CanLoadMore',
      results: [{ role: 'user', status: 'done' }],
    });
    const { result } = renderHook(() => useChatMessages({ threadId: 't' }));
    expect(result.current.messages.length).toBe(1);
    expect(result.current.isLoading).toBe(false);
  });

  it('transitions to STREAMING when assistant is streaming', () => {
    useUIMessagesMock.mockReturnValue({
      status: 'CanLoadMore',
      results: [{ role: 'assistant', status: 'streaming' }],
    });
    const { result } = renderHook(() => useChatMessages({ threadId: 't' }));
    expect(result.current.status).toBe(CHAT_STATUS.STREAMING);
  });

  it('setStatus updates external status', () => {
    useUIMessagesMock.mockReturnValue({
      status: 'CanLoadMore',
      results: [],
    });
    const { result } = renderHook(() => useChatMessages({ threadId: 't' }));
    act(() => {
      result.current.setStatus(CHAT_STATUS.SUBMITTED);
    });
    expect(result.current.status).toBe(CHAT_STATUS.SUBMITTED);
  });
});
