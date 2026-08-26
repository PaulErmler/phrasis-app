import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

type Updater = (
  localStore: {
    getQuery: (ref: unknown, args: unknown) => unknown;
    setQuery: (ref: unknown, args: unknown, value: unknown) => void;
  },
  args: Record<string, unknown>,
) => void;

const mutationFn = vi.fn();
let capturedUpdater: Updater | undefined;

vi.mock('convex/react', () => ({
  useMutation: () => ({
    withOptimisticUpdate: (updater: Updater) => {
      capturedUpdater = updater;
      return mutationFn;
    },
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    features: {
      courses: {
        updateUserSettings: 'updateUserSettings-ref',
        getUserSettings: 'getUserSettings-ref',
      },
    },
  },
}));

import { useUpdateUserSettings } from '@/hooks/use-update-user-settings';

function fakeLocalStore(current: unknown) {
  return {
    getQuery: vi.fn(() => current),
    setQuery: vi.fn(),
  };
}

/**
 * The optimistic update is the contract here: Preferences toggles must flip
 * `getUserSettings` in the same frame, and must never invent a cache entry
 * when the query has not loaded yet.
 */
describe('useUpdateUserSettings', () => {
  beforeEach(() => {
    mutationFn.mockReset();
    capturedUpdater = undefined;
  });

  it('returns the optimistically-wrapped mutation', () => {
    const { result } = renderHook(() => useUpdateUserSettings());
    expect(result.current).toBe(mutationFn);
    expect(capturedUpdater).toBeTypeOf('function');
  });

  it('patches the cached settings with the submitted fields', () => {
    renderHook(() => useUpdateUserSettings());
    const store = fakeLocalStore({ theme: 'dark', autoPlayAudio: false });

    capturedUpdater?.(store, { autoPlayAudio: true });

    expect(store.getQuery).toHaveBeenCalledWith('getUserSettings-ref', {});
    expect(store.setQuery).toHaveBeenCalledWith(
      'getUserSettings-ref',
      {},
      {
        theme: 'dark',
        autoPlayAudio: true,
      },
    );
  });

  it.each([undefined, null])(
    'leaves the cache untouched when the query holds %s',
    (current) => {
      renderHook(() => useUpdateUserSettings());
      const store = fakeLocalStore(current);

      capturedUpdater?.(store, { autoPlayAudio: true });

      expect(store.setQuery).not.toHaveBeenCalled();
    },
  );
});
