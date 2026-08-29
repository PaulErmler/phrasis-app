import { ConvexError } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { getCourseSettings } from '../db/courseSettings';
import {
  canUserAccessCollectionText,
  isPremadeLevelCollection,
} from './collections';

/**
 * Collection/text accessibility predicates, shared by the deck card-adding
 * paths (convex/features/decks.ts) and the collection browse/preview endpoints
 * (convex/features/collections.ts). Lifted out of features/collections.ts so
 * that decks.ts no longer has to import it (which formed the backend's only
 * import cycle: decks ⇄ collections).
 */

export async function isCollectionAccessible(
  ctx: QueryCtx,
  collectionId: Id<'collections'>,
  courseId: Id<'courses'>,
): Promise<boolean> {
  const collection = await ctx.db.get(collectionId);
  if (!collection) return false;

  if (isPremadeLevelCollection(collection)) return true;

  const courseSettings = await getCourseSettings(ctx, courseId);
  if (!courseSettings) return false;

  if (courseSettings.chatCollectionId?.toString() === collectionId.toString())
    return true;
  if (courseSettings.customCollectionId?.toString() === collectionId.toString())
    return true;
  if (
    (courseSettings.activeCustomCollectionIds ?? []).some(
      (id) => id.toString() === collectionId.toString(),
    )
  )
    return true;

  return false;
}

/**
 * Fetch a text and enforce the full access chain for user-facing text
 * endpoints: the text exists, its collection is accessible to the course, and
 * the text itself is within the user's scope (`canUserAccessCollectionText`.
 * Curriculum rows for premade collections, the owner's texts for custom/chat).
 * Throws the same ConvexErrors the previously-inlined checks did.
 */
export async function requireAccessibleText(
  ctx: QueryCtx,
  textId: Id<'texts'>,
  courseId: Id<'courses'>,
  userId: string,
): Promise<{
  text: Doc<'texts'>;
  collection: Doc<'collections'>;
  isLevelCollection: boolean;
}> {
  const text = await ctx.db.get(textId);
  if (!text)
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Text not found' });
  if (!(await isCollectionAccessible(ctx, text.collectionId, courseId))) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: 'Collection not accessible',
    });
  }
  const collection = await ctx.db.get(text.collectionId);
  if (!collection)
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Collection not found',
    });
  if (!canUserAccessCollectionText(collection, text, userId)) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: 'Text not accessible',
    });
  }
  return {
    text,
    collection,
    isLevelCollection: isPremadeLevelCollection(collection),
  };
}
