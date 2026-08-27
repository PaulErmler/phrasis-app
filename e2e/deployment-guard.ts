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
 * deployment's identity, so anything that is not explicitly a development
 * deployment refuses to run, before any command is issued.
 *
 * Development means one of the three prefixes the Convex CLI itself uses for
 * non-production targets: a cloud dev deployment (`dev:`), a local backend
 * (`local:`), or an unlinked local one (`anonymous:`). Prod is `prod:` and
 * previews are `preview:`; neither is ever allowed here.
 */
const DEV_PREFIXES = ['dev:', 'local:', 'anonymous:'] as const;

export function assertDevDeployment(context: string): void {
  const deployment =
    process.env.CONVEX_DEPLOYMENT ?? readDeploymentFromEnvLocal();
  if (!DEV_PREFIXES.some((prefix) => deployment?.startsWith(prefix))) {
    throw new Error(
      `${context}: refusing to touch CONVEX_DEPLOYMENT=` +
        `${JSON.stringify(deployment ?? null)}. The e2e lifecycle scripts ` +
        `enable test hooks and bulk-delete fixture accounts, so they only ` +
        `ever run against a development deployment ` +
        `(${DEV_PREFIXES.join(', ')}). Point CONVEX_DEPLOYMENT / .env.local ` +
        `at one, or run the cleanup by hand.`,
    );
  }
}

/**
 * Same source the Convex CLI falls back to when the env var is unset. The CLI
 * writes the deployment name with a trailing ` # team: …, project: …` comment,
 * so strip that before the prefix check reads it.
 */
function readDeploymentFromEnvLocal(): string | undefined {
  try {
    const envFile = readFileSync(
      path.resolve(__dirname, '..', '.env.local'),
      'utf8',
    );
    const raw = /^CONVEX_DEPLOYMENT=(.+)$/m.exec(envFile)?.[1]?.trim();
    return raw?.replace(/\s+#.*$/, '').trim();
  } catch {
    return undefined;
  }
}
