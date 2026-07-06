import { vi } from 'vitest';

/**
 * Global convex-test setup: mock the workpool clients at the module boundary.
 *
 * Real Workpool calls go through `components.llmPool` / `components.ttsPool`,
 * which convex-test can only provide via `t.registerComponent` (flagged
 * fragile in this project — same reasoning as the rateLimiter module mock in
 * individual test files). Any mutation that enqueues content generation
 * (`enqueueTtsJob`, `enqueueLlmTranslation`, `scheduleMissingContent` callers)
 * would otherwise crash on the missing component.
 *
 * Each enqueue resolves to a unique fake workId so tests can assert the
 * claim → workId stamping and drive onComplete handlers by hand. Tests that
 * need call assertions use `vi.mocked(ttsPool.enqueueAction)` etc.
 */
let nextWorkId = 0;

vi.mock('@/convex/lib/workpools', () => ({
  llmPool: {
    enqueueAction: vi.fn(async () => `test-llm-work-${nextWorkId++}`),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'pending', previousAttempts: 0 })),
  },
  ttsPool: {
    enqueueAction: vi.fn(async () => `test-tts-work-${nextWorkId++}`),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'pending', previousAttempts: 0 })),
  },
}));
