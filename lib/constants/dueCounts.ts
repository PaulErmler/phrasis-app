/**
 * Display ceiling for the merged due count (learning + relearning + review):
 * anything above renders as "100+". Shared by the home-screen DueCountsPills
 * and the learning-mode ProgressDisplay pill so the two surfaces can never
 * disagree about the same number.
 */
export const REVIEWS_CAP = 100;
