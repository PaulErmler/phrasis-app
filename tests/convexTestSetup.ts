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

/**
 * Stub the aggregate component at the same module boundary — production code
 * instantiates `new TableAggregate(components.cardsByState, ...)` at
 * module-load, and the aggregate component is not registered with convex-test
 * (same reasoning as the workpool mocks above). No-op writes, zero counts.
 *
 * A suite that needs stateful aggregate behavior declares its own file-level
 * `vi.mock('@convex-dev/aggregate', ...)`, which takes precedence over this
 * setup-file registration (see recalcUserCardAggregates.test.ts).
 */
vi.mock('@convex-dev/aggregate', () => {
  class TableAggregate {
    constructor(_component: unknown, _opts: unknown) {}
    async insertIfDoesNotExist(): Promise<void> {}
    async replaceOrInsert(): Promise<void> {}
    async deleteIfExists(): Promise<void> {}
    async count(): Promise<number> {
      return 0;
    }
  }
  return { TableAggregate };
});
