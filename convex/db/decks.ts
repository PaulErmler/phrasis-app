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

/**
 * Get a card by its deck and text IDs.
 * Returns null if the card doesn't exist in the deck.
 */
export async function getCardByDeckAndText(
  ctx: QueryCtx,
  deckId: Id<"decks">,
  textId: Id<"texts">
): Promise<Doc<"cards"> | null> {
  return ctx.db
    .query("cards")
    .withIndex("by_deckId_and_textId", (q) =>
      q.eq("deckId", deckId).eq("textId", textId)
    )
    .first();
}
