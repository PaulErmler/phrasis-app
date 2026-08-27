import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TUTORIAL_IDS } from '@/convex/features/tutorialIds';

/**
 * useDifficultyCheck: the one-time "does the difficulty feel right?" check
 * that holds the first auto-add.
 *
 * The feature is currently switched OFF at the source
 * (`DIFFICULTY_CHECK_ENABLED = false`, a module-private const in
 * `components/app/learning/useDifficultyCheck.ts` with no injection point),
 * so the live contract is the disabled one: never hold auto-add, never
 * subscribe to the gating queries, never veteran-retire, while `complete()`
 * keeps persisting so the machinery survives a flag flip without a rebuild.
 *
 * These tests pin that disabled contract. If the flag is flipped back on,
 * the "stays inert" tests below FAIL — deliberately, as a tripwire to
 * re-cover the enabled trigger, which per the hook source is:
 *   pending = isLoaded && !done && lifetimeReps != null
 *             && lifetimeReps <= VETERAN_SUPPRESS_REPS
 *             && currentLevel != null
 * (lifetime reps and the course's OGTE level read via `useQueries` so a
 * server error degrades to "not pending" instead of unwinding the view.)
 *
 * The real `useCompletedTutorials` store runs underneath (localStorage +
 * mocked Convex), same setup as tests/unit/lib/tutorials/use-milestone-tips:
 * the store module caches localStorage at import time, so each test resets
 * modules and re-imports the hook.
 */

// use-tutorial imports driver.js at the top level; keep it out of jsdom.
vi.mock('driver.js', () => ({
  driver: () => ({
    drive: vi.fn(),
    destroy: vi.fn(),
    isActive: () => false,
    moveNext: vi.fn(),
  }),
}));

const state = vi.hoisted(() => ({
  dbCompleted: [] as string[] | undefined,
  lifetimeReps: 0 as number | null | Error,
  currentLevel: 5 as number | null | Error,
  completeMutation: vi.fn(() => Promise.resolve(null)),
  /** Every descriptor object handed to useQueries. */
  useQueriesDescriptors: [] as Record<string, unknown>[],
  /** Names of queries subscribed through useQuery (non-skip only). */
  subscribedQueryNames: [] as string[],
}));

vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  type Ref = Parameters<typeof getFunctionName>[0];
  const resolve = (ref: unknown) => {
    const name = getFunctionName(ref as Ref);
    if (name.includes('getCompletedTutorials')) return state.dbCompleted;
    if (name.includes('getLifetimeReviewCount')) return state.lifetimeReps;
    if (name.includes('getActiveDifficultyLevel')) return state.currentLevel;
    // Auth user: must resolve so `isLoaded` can become true and completions
    // bind to the per-user localStorage key.
    return { userId: 'user_test', _id: 'user_test' };
  };
  return {
    useQuery: (ref: unknown, args?: unknown) => {
      if (args !== 'skip') {
        state.subscribedQueryNames.push(getFunctionName(ref as Ref));
      }
      return args === 'skip' ? undefined : resolve(ref);
    },
    // The hook reads its gating queries through useQueries so errors come
    // back as values. Mirror that: resolve each entry, record the descriptor.
    useQueries: (queries: Record<string, { query: unknown }>) => {
      state.useQueriesDescriptors.push(queries);
      return Object.fromEntries(
        Object.entries(queries).map(([key, { query }]) => [
          key,
          resolve(query),
        ]),
      );
    },
    useMutation: () => state.completeMutation,
  };
});

// Per-user localStorage key of the completed-tutorials store (bound to the
// mocked auth user above).
const STORAGE_KEY = 'phrasis_completed_tutorials_user_test';
const completedIds = (): string[] =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');

let useDifficultyCheck: (typeof import('@/components/app/learning/useDifficultyCheck'))['useDifficultyCheck'];

async function loadHook() {
  ({ useDifficultyCheck } =
    await import('@/components/app/learning/useDifficultyCheck'));
}

describe('useDifficultyCheck (feature flag off)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    state.dbCompleted = [];
    state.lifetimeReps = 0;
    state.currentLevel = 5;
    state.completeMutation.mockClear();
    state.useQueriesDescriptors.length = 0;
    state.subscribedQueryNames.length = 0;
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('stays inert for a fresh, fully-qualified user: pending false, currentLevel null', async () => {
    // A user who WOULD trigger the check if the feature were on: zero
    // lifetime reps (far below the veteran cutoff), a level collection
    // active, nothing completed yet.
    await loadHook();
    const { result } = renderHook(() => useDifficultyCheck());

    expect(result.current.pending).toBe(false);
    expect(result.current.currentLevel).toBeNull();
  });

  it('subscribes to none of the gating queries while disabled', async () => {
    await loadHook();
    renderHook(() => useDifficultyCheck());

    // useQueries only ever receives an empty descriptor…
    expect(state.useQueriesDescriptors.length).toBeGreaterThan(0);
    for (const descriptor of state.useQueriesDescriptors) {
      expect(Object.keys(descriptor)).toEqual([]);
    }
    // …and with no required tutorial ids, the completed-tutorials DB sync
    // is skipped too (localStorage already answers an empty requirement).
    expect(state.subscribedQueryNames).not.toContainEqual(
      expect.stringContaining('getCompletedTutorials'),
    );
    expect(state.subscribedQueryNames).not.toContainEqual(
      expect.stringContaining('getLifetimeReviewCount'),
    );
    expect(state.subscribedQueryNames).not.toContainEqual(
      expect.stringContaining('getActiveDifficultyLevel'),
    );
  });

  it('does not silently veteran-retire the check while disabled', async () => {
    // With the flag on, a veteran (lifetime reps past the suppress cutoff)
    // is silently marked completed. Disabled, nothing may be persisted.
    state.lifetimeReps = 5_000;
    await loadHook();
    renderHook(() => useDifficultyCheck());

    expect(state.completeMutation).not.toHaveBeenCalled();
    expect(completedIds()).toEqual([]);
  });

  it('complete() persists the check exactly once to the mutation and the per-user cache', async () => {
    await loadHook();
    const { result } = renderHook(() => useDifficultyCheck());

    act(() => {
      result.current.complete();
    });

    expect(state.completeMutation).toHaveBeenCalledExactlyOnceWith({
      tutorialId: TUTORIAL_IDS.DIFFICULTY_CHECK,
    });
    expect(completedIds()).toContain(TUTORIAL_IDS.DIFFICULTY_CHECK);
  });

  it('a completed check survives a remount in the same session: still not pending', async () => {
    await loadHook();
    const first = renderHook(() => useDifficultyCheck());
    act(() => {
      first.result.current.complete();
    });
    first.unmount();

    // Same session (module store intact): the completion is already in the
    // per-user localStorage cache, so a fresh mount never re-prompts.
    const second = renderHook(() => useDifficultyCheck());
    expect(second.result.current.pending).toBe(false);
    expect(completedIds()).toContain(TUTORIAL_IDS.DIFFICULTY_CHECK);
  });
});
