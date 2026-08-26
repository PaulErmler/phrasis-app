/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Print the summary even when a test fails; without this a single red
      // test hides the numbers entirely.
      reportOnFailure: true,
      // App + Convex source. Uncovered files matching these globs count
      // against the numbers, so untested modules aren't invisible.
      include: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'hooks/**/*.ts',
        'lib/**/*.{ts,tsx}',
        'convex/**/*.ts',
        'i18n/**/*.{ts,tsx}',
        'middleware.ts',
      ],
      exclude: [
        'convex/_generated/**',
        'convex/tests/**',
        // Vendored shadcn/ai-elements component libraries.
        'components/ui/**',
        'components/ai-elements/**',
        '**/*.d.ts',
      ],
      // Backslide alarm, not an aspiration: pinned ~2-3 points below the
      // numbers measured 2026-08-26 (stmts 57.7, branch 49.5, funcs 51.6,
      // lines 58.8). Raise them as real coverage grows; never lower them to
      // make a PR pass.
      thresholds: {
        statements: 55,
        branches: 47,
        functions: 49,
        lines: 56,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'convex',
          environment: 'edge-runtime',
          include: ['convex/tests/**/*.test.ts'],
          // Lives OUTSIDE convex/ on purpose: the Convex bundler analyzes
          // every non-test module under convex/, and a top-level vi.mock
          // crashes that analysis (InvalidModules on push).
          setupFiles: ['./tests/convexTestSetup.ts'],
          server: { deps: { inline: ['convex-test'] } },
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': path.resolve(__dirname, './'),
          },
        },
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/node/**'],
          setupFiles: ['./tests/setup.ts'],
          globals: true,
        },
      },
      {
        extends: true,
        test: {
          // Real-Node suite for code that needs Node APIs unavailable in
          // edge-runtime/jsdom — today the espeak-ng WASM engine, which
          // loads its data bundle from disk (convex tests stub it instead;
          // see tests/convexTestSetup.ts).
          name: 'node',
          environment: 'node',
          include: ['tests/node/**/*.test.ts'],
        },
      },
    ],
  },
});
