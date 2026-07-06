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
          setupFiles: ["./tests/setup.ts"],
          globals: true,
        },
      },
    ],
  },
});
