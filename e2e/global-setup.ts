import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Enable E2E test hooks on the dev deployment for the duration of the test
 * run. The flag makes the backend:
 *   - capture auth emails (verification codes / reset links) into the
 *     `testAuthEmails` table instead of sending real mail
 *     (convex/lib/authEmails.ts), and
 *   - accept the `npx convex run` test hooks (features/authEmailTesting.ts,
 *     usage/testing.ts).
 *
 * global-teardown.ts removes it again, so normal dev usage outside test
 * runs sends real emails. If a run is killed hard (teardown skipped),
 * remove it manually: `npx convex env remove E2E_TEST_HOOKS`.
 */
export default function globalSetup() {
  execFileSync("npx", ["convex", "env", "set", "E2E_TEST_HOOKS", "1"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
}
