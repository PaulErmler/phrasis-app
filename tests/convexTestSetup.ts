import { vi } from 'vitest';

/**
 * Global convex-test setup: mock the workpool clients at the module boundary.
 *
 * Real Workpool calls go through `components.llmPool` / `components.ttsPool`,
 * which convex-test can only provide via `t.registerComponent` (flagged
 * fragile in this project, same reasoning as the rateLimiter module mock in
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
  // Background sibling of llmPool for llmPriority-'background' translations
  // (the onboarding / admin warmups). Same fake-workId contract.
  llmWarmPool: {
    enqueueAction: vi.fn(async () => `test-llm-warm-work-${nextWorkId++}`),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'pending', previousAttempts: 0 })),
  },
  ttsPool: {
    enqueueAction: vi.fn(async () => `test-tts-work-${nextWorkId++}`),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'pending', previousAttempts: 0 })),
  },
  // Background sibling of ttsPool for priority-'background' TTS (warm
  // sweeps). Same fake-workId contract so claim stamping stays assertable.
  ttsWarmPool: {
    enqueueAction: vi.fn(async () => `test-tts-warm-work-${nextWorkId++}`),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'pending', previousAttempts: 0 })),
  },
  // The seed pool enqueues MUTATIONS, and unlike the content pools its jobs
  // must actually run for a test to observe anything (the writing-track sweep
  // chains batch → batch until the course is seeded). Route each job through
  // `ctx.scheduler` so the existing `drainScheduler` helper drives the chain
  // exactly as it did when the sweep self-scheduled.
  //
  // The `onComplete` supervisor is deliberately NOT invoked here: modelling
  // "the batch threw but its onComplete still ran" needs a separate
  // transaction, which convex-test's scheduler can't express. Tests that
  // exercise the failure path call `onSeedBatchComplete` directly with a
  // `{ kind: 'failed' }` result.
  seedPool: {
    enqueueMutation: vi.fn(
      async (
        ctx: { scheduler: { runAfter: (d: number, fn: unknown, a: unknown) => Promise<unknown> } },
        fn: unknown,
        args: unknown,
      ) => {
        await ctx.scheduler.runAfter(0, fn, args);
        return `test-seed-work-${nextWorkId++}`;
      },
    ),
    cancel: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ state: 'pending', previousAttempts: 0 })),
  },
}));

/**
 * Stub the aggregate component at the same module boundary. Production code
 * instantiates `new TableAggregate(components.cardsByStateAndDueDate, ...)` at
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

/**
 * Stub the PostHog Convex client for the same reason as the mocks above: the
 * `posthog` component is not registered with convex-test, and production code
 * constructs `new PostHog(components.posthog)` at module load.
 *
 * All methods are no-op spies, so suites that care can assert an event fired
 * (`vi.mocked(posthog.capture)`) without any of them needing network access or
 * a project token. Analytics must never be the reason a test fails.
 */
vi.mock('@/convex/posthog', () => ({
  posthog: {
    capture: vi.fn(async () => undefined),
    identify: vi.fn(async () => undefined),
    captureException: vi.fn(async () => undefined),
    groupIdentify: vi.fn(async () => undefined),
    alias: vi.fn(async () => undefined),
  },
}));

/**
 * Stub the espeak-ng WASM engine (IPA transcription). The real module reads
 * its ~24 MB data bundle from disk, which the edge-runtime test environment
 * has no filesystem for, and any test that drains the scheduler after a
 * translation lands would otherwise execute `processIpaFor*` and crash on
 * the import. The stub yields a fixed transcription in espeak's raw shape
 * (`_`-separated phonemes + trailing newline) so `cleanEspeakIpa`'s
 * post-processing stays exercised. Real-engine coverage lives in the
 * node-environment suite (tests/node/espeak-ipa.test.ts).
 */
vi.mock('@echogarden/espeak-ng-emscripten', () => ({
  default: async () => ({
    eSpeakNGWorker: class {
      set_voice(_identifier: string): void {}
      synthesize_ipa(_text: string): { code: number; ipa: string } {
        return { code: 0, ipa: 'm_ˈɒ_k_aɪ_p_iː_eɪ\n' };
      }
      list_voices(): unknown[] {
        return [];
      }
    },
  }),
}));
