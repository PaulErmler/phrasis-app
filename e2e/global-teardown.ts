import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Counterpart to global-setup.ts: remove the E2E_TEST_HOOKS flag so the
 * dev deployment goes back to sending real auth emails after the run.
 * Best-effort — a failure here must not turn a green suite red.
 */
export default function globalTeardown() {
  try {
    execFileSync("npx", ["convex", "env", "remove", "E2E_TEST_HOOKS"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
  } catch (error) {
    console.warn(
      "Failed to remove E2E_TEST_HOOKS after the test run — remove it " +
        "manually with `npx convex env remove E2E_TEST_HOOKS`:",
      error,
    );
  }
}
