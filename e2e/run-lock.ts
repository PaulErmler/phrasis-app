import fs from "node:fs";
import path from "node:path";

/**
 * Tracks concurrent Playwright invocations by PID so overlapping runs don't
 * unset E2E_TEST_HOOKS out from under each other. A second run's teardown
 * once disabled the flag mid-way through a full run, failing every later
 * auth-email fetch and skipping all dependent projects. Best-effort: entries
 * from killed runs are ignored via a liveness check, so a hard-killed run
 * cannot wedge the lock (though, as before, it leaves the flag set, see
 * global-setup.ts for the manual cleanup command).
 */
const LOCK_FILE = path.resolve(__dirname, ".auth", "e2e-run-pids.json");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLivePids(): number[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (pid): pid is number => typeof pid === "number" && isAlive(pid),
    );
  } catch {
    return [];
  }
}

function writePids(pids: number[]): void {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify(pids));
}

export function registerRun(): void {
  const pids = readLivePids().filter((pid) => pid !== process.pid);
  pids.push(process.pid);
  writePids(pids);
}

/** Drops this run from the lock; true when it was the last live run. */
export function unregisterRun(): boolean {
  const others = readLivePids().filter((pid) => pid !== process.pid);
  writePids(others);
  return others.length === 0;
}
