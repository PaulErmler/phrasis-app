/**
 * Ring stepping for tap-to-cycle controls (per-card speed badge, reps tile).
 * Dependency-free on purpose: `lib/constants/audioPlayback.ts` is bundled
 * into Convex functions, so anything it imports must stay free of browser or
 * UI libraries.
 */

/**
 * The element after `current` in a fixed ring, wrapping at the end. A
 * `current` that isn't in the ring yields the first element, so a stale or
 * out-of-range stored value restarts the cycle instead of throwing.
 */
export function cycleNext<T>(cycle: readonly T[], current: unknown): T {
  const idx = (cycle as readonly unknown[]).indexOf(current);
  return cycle[(idx + 1) % cycle.length];
}
