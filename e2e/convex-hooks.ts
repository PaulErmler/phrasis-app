import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractJsonResult } from './cli-json-output';

/**
 * Shared plumbing for specs that call E2E_TEST_HOOKS-gated Convex functions
 * via `convex run`. New specs import from here; the older specs
 * (curriculum-edit-flag, writing-alternatives-live) carry their own copies
 * pending the helpers split (docs/tech-debt.md C35).
 */

const REPO_ROOT = path.resolve(__dirname, '..');

export function convexRun(fn: string, args: Record<string, unknown>): unknown {
  const out = execFileSync(
    'pnpm',
    ['exec', 'convex', 'run', fn, JSON.stringify(args)],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return extractJsonResult(out);
}

/** The shared fixture user A's email (minted by auth.setup.ts). */
export function fixtureEmail(): string {
  const creds = JSON.parse(
    fs.readFileSync(
      path.resolve(REPO_ROOT, 'e2e/.auth/credentials-a.json'),
      'utf8',
    ),
  ) as { email: string };
  return creds.email;
}

export function deckCardCount(email: string): number {
  return convexRun('features/deckTesting:cardCount', { email }) as number;
}

export function deckDuplicateTextCount(email: string): number {
  return convexRun('features/deckTesting:duplicateTextCount', {
    email,
  }) as number;
}
