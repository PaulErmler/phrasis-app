/**
 * Resolves the identity of this build and writes it to `.build-id.json`, which
 * next.config.ts reads back. Run from `pnpm build`, before `next build`.
 *
 * Why a file rather than resolving inline in next.config.ts: Next re-evaluates
 * the config in its static-generation workers, so anything recomputed there can
 * differ between the client bundle's inlined value and the prerendered
 * /api/version body. AppUpdateGate compares exactly those two, and a mismatch
 * means announcing an update on a deployment that never changed. Resolving once
 * here and having every later read hit the same file removes that whole class of
 * bug — and makes a timestamp safe as the last resort.
 *
 * The timestamp matters because neither of the earlier strategies survives a
 * real host. Coolify builds with Nixpacks from `COPY . /app/.`, which excludes
 * `.git`, and the resulting image has no `git` binary either — so both the host
 * env vars and `git rev-parse` come up empty, and the build id silently pinned
 * to 'dev' with update detection dead. A timestamp always changes, needs nothing
 * from the host, and additionally gives same-commit rebuilds a fresh identity.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_FILE = join(process.cwd(), '.build-id.json');

/** Hosts that announce the commit, in order of trust. */
const HOST_SOURCES = [
  ['BUILD_ID', process.env.BUILD_ID],
  ['SOURCE_COMMIT', process.env.SOURCE_COMMIT],
  ['VERCEL_GIT_COMMIT_SHA', process.env.VERCEL_GIT_COMMIT_SHA],
  ['VERCEL_DEPLOYMENT_ID', process.env.VERCEL_DEPLOYMENT_ID],
];

/** The checked-out commit, for hosts that build from a clone but announce nothing. */
function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // No .git in the build context, or no git binary in the image.
    return undefined;
  }
}

// Matched on truthiness rather than `??`: a host that sets its variable to the
// empty string would otherwise pass it straight through as the build id.
const host = HOST_SOURCES.find(([, value]) => value);
const git = host ? undefined : gitCommit();

const [source, buildId] = host
  ? [host[0], host[1]]
  : git
    ? ['git', git]
    : ['timestamp', `t${Date.now().toString(36)}`];

writeFileSync(OUTPUT_FILE, `${JSON.stringify({ buildId, source }, null, 2)}\n`);
console.log(`[build-id] ${buildId} (from ${source})`);
