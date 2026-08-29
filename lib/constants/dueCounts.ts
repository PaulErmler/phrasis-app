/**
 * Display ceiling for the merged due count (learning + relearning + review):
 * anything above renders as "100+". Shared by the home-screen DueCountsPills
 * and the learning-mode ProgressDisplay pill so the two surfaces can never
 * disagree about the same number.
 */
export const REVIEWS_CAP = 100;

/** The merge rule: learning + relearning + review collapse into one number. */
export function mergedDueCount(counts: {
  learning: number;
  relearning: number;
  review: number;
}): number {
  return counts.learning + counts.relearning + counts.review;
}

/** "100+" past the cap, the bare number otherwise. */
export function formatCappedCount(value: number, cap = REVIEWS_CAP): string {
  return value > cap ? `${cap}+` : String(value);
}
