import type { EnvFromAppDefinition } from 'convex/server';
import type appConfig from '../convex.config';

/**
 * Typed access to the app-provided Convex environment variables.
 *
 * Allowed names derive (type-only) from the `defineApp({ env: ... })`
 * declaration in `convex.config.ts`, so a typo'd name is a compile error and
 * every new variable must be declared there first. (`env` from
 * `./_generated/server` exposes the same values, but its type is baked by
 * codegen and only regenerates under `npx convex dev`; this accessor keys
 * off the config's own type, so declarations flow through immediately.)
 *
 * Reads go through `process.env` at call time, which preserves two
 * properties call sites rely on:
 *
 * - a missing key fails only the code path that needs it — call these from
 *   inside handlers, not at module scope, unless failing analysis of the
 *   whole module on a key-less deployment is the intent (convex/auth.ts and
 *   convex/autumn.ts do this deliberately);
 * - test suites can stub keys via `vi.stubEnv(...)` or plain
 *   `process.env.X = ...` assignment.
 */
type AppEnv = EnvFromAppDefinition<typeof appConfig>;

export type AppEnvVarName = keyof AppEnv & string;

/**
 * Read a variable the current code path cannot work without. Throws a
 * named, actionable error when the variable is unset (or empty — no caller
 * distinguishes an empty secret from a missing one).
 */
export function requireEnv(name: AppEnvVarName): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} environment variable is not set` +
        ` (configure it with \`npx convex env set ${name}\`)`,
    );
  }
  return value;
}

/** Read a variable the caller degrades gracefully without. */
export function optionalEnv(name: AppEnvVarName): string | undefined {
  return process.env[name];
}
