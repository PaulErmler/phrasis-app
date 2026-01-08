import { v, Infer } from "convex/values";

export const learningStyleValidator = v.union(
  v.literal("casual"),
  v.literal("focused"),
  v.literal("advanced")
);

export const currentLevelValidator = v.union(
  v.literal("beginner"),
  v.literal("elementary"),
  v.literal("intermediate"),
  v.literal("upper_intermediate"),
  v.literal("advanced")
);

export type LearningStyle = Infer<typeof learningStyleValidator>;
export type CurrentLevel = Infer<typeof currentLevelValidator>;
