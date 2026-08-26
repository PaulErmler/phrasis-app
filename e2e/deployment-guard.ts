import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Hard gate for the destructive e2e lifecycle scripts: global-setup flips
 * E2E_TEST_HOOKS on the target deployment (which also reroutes real auth
 * emails into `testAuthEmails` — a login outage if that deployment were
 * prod), and global-teardown bulk-purges fixture accounts.
 *
 * E2E_TEST_HOOKS itself cannot protect the deployment, because the harness
 * is what sets that flag — a guard the guarded code satisfies for itself is
 * no guard. The one thing these scripts cannot grant themselves is the
 * deployment's identity, so anything that is not explicitly a dev
 * deployment (`dev:...`) refuses to run, before any command is issued.
 */
export function assertDevDeployment(context: string): void {
  const deployment =
    process.env.CONVEX_DEPLOYMENT ?? readDeploymentFromEnvLocal();
  if (!deployment?.startsWith('dev:')) {
    throw new Error(
      `${context}: refusing to touch CONVEX_DEPLOYMENT=` +
        `${JSON.stringify(deployment ?? null)}. The e2e lifecycle scripts ` +
        `enable test hooks and bulk-delete fixture accounts, so they only ` +
        `ever run against a dev deployment (dev:...). Point ` +
        `CONVEX_DEPLOYMENT / .env.local at one, or run the cleanup by hand.`,
    );
  }
}

/** Same source the Convex CLI falls back to when the env var is unset. */
function readDeploymentFromEnvLocal(): string | undefined {
  try {
    const envFile = readFileSync(
      path.resolve(__dirname, '..', '.env.local'),
      'utf8',
    );
    return /^CONVEX_DEPLOYMENT=(.+)$/m.exec(envFile)?.[1]?.trim();
  } catch {
    return undefined;
  }
}
