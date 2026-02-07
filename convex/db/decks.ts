import { QueryCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";

/**
 * Get the deck for a given course.
 */
export async function getDeckByCourseId(
  ctx: QueryCtx,
  courseId: Id<"courses">
): Promise<Doc<"decks"> | null> {
  return ctx.db
    .query("decks")
    .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
    .first();
}
