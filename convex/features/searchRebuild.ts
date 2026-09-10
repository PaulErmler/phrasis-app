import { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';
import { buildSearchableTextPatchForCard } from '../lib/cardContent';

/**
 * Card search-string rebuild: keeps `cards.searchableText` correct for
 * content that lands AFTER a card was created (late translations, annotation
 * backfills, retranslations). Owns the per-text debounce marker and the
 * batched, self-continuing fan-out over every card referencing a text. The
 * registered continuation (`rebuildSearchableTextForText`) stays in
 * features/decks.ts and delegates here.
 */

const REBUILD_SEARCHABLE_BATCH = 50;

/**
 * Content lands in bursts. A text gets its translations and romanizations
 * for every course language within seconds, and each store used to schedule
 * its own full rebuild over every card referencing the text (premade texts
 * are shared across all users' decks, so one burst multiplied into thousands
 * of redundant card patches). Debounce: one pending rebuild per text,
 * marked on the text row; stores inside the window piggyback on it (the
 * rebuild reads content at run time, so it picks up everything the burst
 * wrote).
 */
const SEARCHABLE_REBUILD_DEBOUNCE_MS = 10_000;

export async function scheduleSearchableTextRebuild(
  ctx: MutationCtx,
  textId: Id<'texts'>,
): Promise<void> {
  const text = await ctx.db.get(textId);
  if (!text) return;
  const now = Date.now();
  if (
    text.searchableRebuildScheduledAt !== undefined &&
    text.searchableRebuildScheduledAt > now
  ) {
    return;
  }
  await ctx.db.patch(textId, {
    searchableRebuildScheduledAt: now + SEARCHABLE_REBUILD_DEBOUNCE_MS,
  });
  await ctx.scheduler.runAfter(
    SEARCHABLE_REBUILD_DEBOUNCE_MS,
    internal.features.decks.rebuildSearchableTextForText,
    { textId },
  );
}

/**
 * Rebuild `searchableText` on every card referencing a text, in batches with
 * self-continuation. Handler body of `rebuildSearchableTextForText` (see the
 * registration in features/decks.ts for the scheduling contract).
 */
export async function rebuildSearchableTextForTextHandler(
  ctx: MutationCtx,
  args: { textId: Id<'texts'>; cursor?: string },
): Promise<null> {
  // Text may have been cascade-deleted while this job was queued.
  const text = await ctx.db.get(args.textId);
  if (!text) return null;

  // First batch: release the debounce marker so content landing from here
  // on schedules a fresh rebuild (this run reads content as of now).
  if (
    args.cursor === undefined &&
    text.searchableRebuildScheduledAt !== undefined
  ) {
    await ctx.db.patch(args.textId, {
      searchableRebuildScheduledAt: undefined,
    });
  }

  const page = await ctx.db
    .query('cards')
    .withIndex('by_textId', (q) => q.eq('textId', args.textId))
    .paginate({
      numItems: REBUILD_SEARCHABLE_BATCH,
      cursor: args.cursor ?? null,
    });

  // Shared per-page caches: deck→languages resolved once per deck, live rows
  // read once per language list, built strings memoized per (textId,
  // languages, served revisions). Every card here shares one text, so the
  // build runs once per distinct language list and revision set.
  const caches = {
    deckLanguages: new Map<Id<'decks'>, string[] | null>(),
    liveRows: new Map<string, (Doc<'translations'> | null)[]>(),
    built: new Map<
      string,
      { searchableText: string; searchableTextLanguages: string[] }
    >(),
  };

  for (const card of page.page) {
    const built = await buildSearchableTextPatchForCard(
      ctx,
      card,
      text,
      caches,
    );
    if (built) {
      // Raw `db.patch`, NOT `patchCard`. None of the four card aggregates
      // key on `searchableText` / `searchableTextLanguages` (they key on
      // deckId, dueDate, the state label and collectionOrigin), so
      // `patchCard`'s unconditional `replaceOrInsert` would do four btree
      // delete+inserts per card that reproduce a byte-identical entry.
      // That is not just wasted work: aggregate internal nodes are a write
      // -contention hotspot, and this job fans out over every card for the
      // text across every user. `migrations.ts:rebuildCardSearchableText`
      // bypasses them for the identical write for the same reason.
      await ctx.db.patch(card._id, built);
    }
  }

  if (!page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.decks.rebuildSearchableTextForText,
      { textId: args.textId, cursor: page.continueCursor },
    );
  }
  return null;
}
