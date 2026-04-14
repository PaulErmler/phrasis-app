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
