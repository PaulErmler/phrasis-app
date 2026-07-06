import { afterEach } from 'vitest';

/**
 * Flush pending 0ms scheduler timers inside the test context.
 *
 * convex-test executes scheduled functions on real timers, and enqueue-style
 * mutations now fan out through a chain of 0ms hops (requestPump relay →
 * pump → worker action). A test body runs entirely in microtasks, so those
 * chains only start firing after the test ends — and their console output
 * then races vitest's environment teardown, failing the run with
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
 * pending`. Registering this afterEach lets each hop run (one macrotask per
 * round) while the test context is still alive. Call once at the top level
 * of any test file whose tests enqueue TTS/LLM queue work.
 */
export function drainSchedulerAfterEach(rounds = 20): void {
  afterEach(async () => {
    for (let i = 0; i < rounds; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}
