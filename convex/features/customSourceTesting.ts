import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { assertTestHooksEnabled, requireUserIdByEmail } from '../lib/testHooks';
import { getOrCreateCustomCollection } from '../db/collections';

/**
 * E2E test hooks for the auto-add source split
 * (`e2e/auto-add-sources.spec.ts`). Every function throws unless the
 * deployment has `E2E_TEST_HOOKS=1` set.
 *
 * Why a seeding hook rather than driving the add-cards form: the behaviour
 * under test is a PROPORTION — roughly half a batch from each source — and
 * proving one needs a known number of pending custom texts on the fixture
 * user before the batch runs. Typing them in through the UI would take a
 * dozen page interactions per text and leave the count at the mercy of
 * whatever earlier specs added.
 *
 * The texts are inserted straight into the user's Custom collection with no
 * content pipeline attached. They are plain rows: translation and audio are
 * scheduled later, by the add path, exactly as they are for a hand-typed
 * sentence. `cleanupSeededTexts` puts the fixture user back.
 */

/** Cap on one seeding call. The specs ask for tens, not thousands. */
const MAX_SEED_TEXTS = 200;

async function activeCourseForEmail(
  ctx: MutationCtx,
  email: string,
): Promise<{ userId: string; course: Doc<'courses'> }> {
  const userId = await requireUserIdByEmail(ctx, email);
  const settings = await ctx.db
    .query('userSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
  const courseId = settings?.activeCourseId;
  if (!courseId) throw new Error(`No active course for "${email}"`);
  const course = await ctx.db.get(courseId);
  if (!course) throw new Error(`Active course ${courseId} is missing`);
  return { userId, course };
}

/**
 * Put `count` pending texts in the user's Custom collection, tagged with
 * `marker` so cleanup and any manual inspection can find them.
 *
 * Ranks continue past the collection's current high-water mark: the add
 * scan walks the rank index from the stored frontier, so texts inserted
 * behind it would be invisible.
 */
export const seedCustomTexts = internalMutation({
  args: { email: v.string(), count: v.number(), marker: v.string() },
  returns: v.object({
    collectionId: v.id('collections'),
    textIds: v.array(v.id('texts')),
  }),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    if (args.count < 1 || args.count > MAX_SEED_TEXTS) {
      throw new Error(`count must be 1..${MAX_SEED_TEXTS}, got ${args.count}`);
    }
    const { userId, course } = await activeCourseForEmail(ctx, args.email);
    const collection = await getOrCreateCustomCollection(ctx, course._id);

    // Highest rank in the collection, not `textCount`: a collection whose
    // texts were partly deleted has ranks past its count, and reusing one
    // would put two texts on the same rung of the scan.
    const highest = await ctx.db
      .query('texts')
      .withIndex('by_collection_and_rank', (q) =>
        q.eq('collectionId', collection._id),
      )
      .order('desc')
      .first();
    let rank = highest?.collectionRank ?? 0;

    const textIds: Id<'texts'>[] = [];
    // The custom scan is scoped by owner (`forUserId`), so these must carry
    // the user id or the add path cannot see them.
    const language = course.targetLanguages[0] ?? 'es';
    for (let i = 1; i <= args.count; i++) {
      rank += 1;
      textIds.push(
        await ctx.db.insert('texts', {
          text: `${args.marker} ${i}`,
          language,
          userCreated: true,
          userId,
          collectionId: collection._id,
          collectionRank: rank,
        }),
      );
    }
    await ctx.db.patch(collection._id, {
      textCount: collection.textCount + args.count,
    });
    return { collectionId: collection._id, textIds };
  },
});

/**
 * Undo `seedCustomTexts`: drop the seeded texts, the cards made from them,
 * and the progress they booked.
 *
 * `cardsAdded` has to come back down with the cards or the collection reads
 * as more settled than it is, and the NEXT run of these specs would find a
 * Custom collection that reports itself complete. The frontier
 * (`lastRankProcessed`) is deliberately left where it is: it points past
 * ranks that no longer hold texts, which costs nothing, while rewinding it
 * would send the scan back over texts other specs legitimately added.
 */
export const cleanupSeededTexts = internalMutation({
  args: { email: v.string(), textIds: v.array(v.id('texts')) },
  returns: v.object({ textsDeleted: v.number(), cardsDeleted: v.number() }),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const { userId, course } = await activeCourseForEmail(ctx, args.email);

    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .take(5);

    let cardsDeleted = 0;
    let textsDeleted = 0;
    const removedPerCollection = new Map<string, number>();

    for (const textId of args.textIds) {
      const text = await ctx.db.get(textId);
      for (const deck of decks) {
        const cards = await ctx.db
          .query('cards')
          .withIndex('by_deckId_and_textId', (q) =>
            q.eq('deckId', deck._id).eq('textId', textId),
          )
          .collect();
        for (const card of cards) {
          await ctx.db.delete(card._id);
          cardsDeleted++;
          const key = card.collectionId?.toString();
          if (key) {
            removedPerCollection.set(
              key,
              (removedPerCollection.get(key) ?? 0) + 1,
            );
          }
        }
      }
      if (!text) continue;
      await ctx.db.delete(textId);
      textsDeleted++;
      if (text.collectionId) {
        const coll = await ctx.db.get(text.collectionId);
        if (coll) {
          await ctx.db.patch(coll._id, {
            textCount: Math.max(0, coll.textCount - 1),
          });
        }
      }
    }

    for (const [collectionKey, removed] of removedPerCollection) {
      const collectionId = collectionKey as Id<'collections'>;
      const progress = await ctx.db
        .query('collectionProgress')
        .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
          q
            .eq('userId', userId)
            .eq('courseId', course._id)
            .eq('collectionId', collectionId),
        )
        .first();
      if (progress) {
        await ctx.db.patch(progress._id, {
          cardsAdded: Math.max(0, (progress.cardsAdded ?? 0) - removed),
        });
      }
    }

    return { textsDeleted, cardsDeleted };
  },
});
