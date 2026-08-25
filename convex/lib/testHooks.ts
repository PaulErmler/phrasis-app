/**
 * The gate every e2e-only backend hook stands behind. Enable
 * `E2E_TEST_HOOKS=1` ONLY on dev/test deployments, never in production —
 * the hooks behind it capture auth emails, rig curriculum flag counters,
 * and bulk-delete fixture accounts.
 *
 * One definition (was copied into authEmailTesting, curriculumFlagTesting,
 * and e2eCleanup) so the guard cannot drift between hook modules.
 */
export function assertTestHooksEnabled(): void {
  if (process.env.E2E_TEST_HOOKS !== '1') {
    throw new Error(
      'E2E test hooks are disabled (set E2E_TEST_HOOKS=1 on a dev deployment)',
    );
  }
}
