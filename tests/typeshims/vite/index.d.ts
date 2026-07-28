/* Stand-in for the `vite` type package so the `vite/client` reference
 * directives in convex/tests resolve under tsconfig.test.json (vite is not a
 * direct dependency, so pnpm exposes no root `vite` package). */
export {};
