import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertDevDeployment } from '@/e2e/deployment-guard';

// The .env.local fallback path is exercised with a mocked fs read — the real
// file must never be involved in a test run.
vi.mock('node:fs', () => {
  const readFileSync = vi.fn();
  return { readFileSync, default: { readFileSync } };
});

describe('assertDevDeployment', () => {
  beforeEach(() => {
    // A deploy key in the developer's shell must not leak into these cases —
    // it has its own tests below.
    vi.stubEnv('CONVEX_DEPLOY_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('passes for a dev deployment', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:brave-otter-123');
    expect(() => assertDevDeployment('test')).not.toThrow();
  });

  it('passes for a local backend', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'local:flexling-app');
    expect(() => assertDevDeployment('test')).not.toThrow();
  });

  it('passes for an anonymous local backend', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'anonymous:flexling-app');
    expect(() => assertDevDeployment('test')).not.toThrow();
  });

  it('refuses a prod deployment', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'prod:flexling-app');
    expect(() => assertDevDeployment('test')).toThrow(/refusing/);
  });

  it('refuses preview and other non-dev deployments', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'preview:pr-42');
    expect(() => assertDevDeployment('test')).toThrow(/refusing/);
  });

  it('refuses when no deployment is configured anywhere', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', undefined);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => assertDevDeployment('test')).toThrow(/refusing/);
  });

  it('strips the CLI comment from the .env.local fallback', () => {
    // The Convex CLI writes `CONVEX_DEPLOYMENT=dev:name # team: …, project: …`;
    // the guard must read the name, not refuse over the comment.
    vi.stubEnv('CONVEX_DEPLOYMENT', undefined);
    vi.mocked(readFileSync).mockReturnValue(
      'CONVEX_DEPLOYMENT=dev:brave-otter-123 # team: paul, project: flexling\n',
    );
    expect(() => assertDevDeployment('test')).not.toThrow();
  });

  it('still refuses prod read from .env.local, comment and all', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', undefined);
    vi.mocked(readFileSync).mockReturnValue(
      'CONVEX_DEPLOYMENT=prod:flexling-app # team: paul, project: flexling\n',
    );
    expect(() => assertDevDeployment('test')).toThrow(/refusing/);
  });

  it('accepts a quoted CONVEX_DEPLOYMENT in .env.local', () => {
    // dotenv accepts quoted values, so a hand-written `"dev:..."` must not
    // be refused over its quotes.
    vi.stubEnv('CONVEX_DEPLOYMENT', undefined);
    vi.mocked(readFileSync).mockReturnValue(
      'CONVEX_DEPLOYMENT="dev:brave-otter-123"\n',
    );
    expect(() => assertDevDeployment('test')).not.toThrow();
  });

  it('refuses a non-dev CONVEX_DEPLOY_KEY even when CONVEX_DEPLOYMENT is dev', () => {
    // The CLI resolves its target from the deploy key BEFORE the deployment
    // name, so a prod key must refuse regardless of the dev .env.local.
    vi.stubEnv('CONVEX_DEPLOY_KEY', 'prod:flexling-app|ey...');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:brave-otter-123');
    expect(() => assertDevDeployment('test')).toThrow(/CONVEX_DEPLOY_KEY/);
  });

  it('refuses a preview CONVEX_DEPLOY_KEY', () => {
    vi.stubEnv('CONVEX_DEPLOY_KEY', 'preview:pr-42|ey...');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:brave-otter-123');
    expect(() => assertDevDeployment('test')).toThrow(/CONVEX_DEPLOY_KEY/);
  });

  it('accepts a dev CONVEX_DEPLOY_KEY alongside a dev deployment', () => {
    vi.stubEnv('CONVEX_DEPLOY_KEY', 'dev:brave-otter-123|ey...');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:brave-otter-123');
    expect(() => assertDevDeployment('test')).not.toThrow();
  });
});
