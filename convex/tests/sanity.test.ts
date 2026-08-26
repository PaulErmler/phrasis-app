/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from '../schema';

const modules = import.meta.glob('/convex/**/*.ts');

describe('convex project sanity', () => {
  it('initializes a convex-test harness', async () => {
    const t = convexTest(schema, modules);
    expect(t).toBeDefined();
  });
});
