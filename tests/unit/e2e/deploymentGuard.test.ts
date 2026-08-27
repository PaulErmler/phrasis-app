import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertDevDeployment } from '@/e2e/deployment-guard';

// The .env.local fallback path is exercised with a mocked fs read — the real
// file must never be involved in a test run.
vi.mock('node:fs', () => {
  const readFileSync = vi.fn();
  return { readFileSync, default: { readFileSync } };
});

describe('assertDevDeployment', () => {
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
});
