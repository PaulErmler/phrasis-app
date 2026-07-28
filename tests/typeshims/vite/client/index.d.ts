/* Minimal `vite/client` surface for the test typecheck: only what the test
 * files actually use (`import.meta.glob` for convex-test module maps). At
 * runtime Vitest provides the real implementation. */
interface ImportMeta {
  glob(
    pattern: string | string[],
    options?: Record<string, unknown>,
  ): Record<string, () => Promise<unknown>>;
}
