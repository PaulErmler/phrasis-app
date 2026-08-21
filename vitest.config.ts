/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/tests/**/*.test.ts"],
          // Lives OUTSIDE convex/ on purpose: the Convex bundler analyzes
          // every non-test module under convex/, and a top-level vi.mock
          // crashes that analysis (InvalidModules on push).
          setupFiles: ["./tests/convexTestSetup.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./"),
          },
        },
        test: {
          name: "app",
          environment: "jsdom",
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/node/**"],
          setupFiles: ["./tests/setup.ts"],
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
          name: "node",
          environment: "node",
          include: ["tests/node/**/*.test.ts"],
        },
      },
    ],
  },
});
