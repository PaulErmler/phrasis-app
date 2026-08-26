import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertDevDeployment } from '@/e2e/deployment-guard';

describe('assertDevDeployment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes for a dev deployment', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'dev:brave-otter-123');
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
});
