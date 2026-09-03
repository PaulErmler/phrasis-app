import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type ContentCtx = QueryCtx | MutationCtx;

/**
 * Card-facing translation reads.
 *
 * A curriculum translation row is shared by every learner's card for that
 * text. When a version bump regenerates the row's wording, the previous
 * wording moves to `translationArchive` (see schema.ts) and the live row
 * remembers `lastArchivedAt`. A card is served the wording that was live at
 * its PIN: `translationsAcceptedAt` when set, else `_creationTime`. So an
 * existing learner keeps seeing (and hearing) exactly what they learned,
 * while a card added later gets the new wording, with zero per-card writes.
 *
 * Every reader that shows a translation ON A CARD goes through
 * `resolveServedTranslation` / `resolveServedFromLive` with the card's pin.
 * Readers with no card in hand (collection preview, placement test, the
 * content pipeline itself) keep reading the live row: they describe the
 * curriculum, not a learner's card.
 */

/** The instant a card's translations are pinned to. */
export function cardPinAt(
  card: Pick<Doc<'cards'>, '_creationTime' | 'translationsAcceptedAt'>,
): number {
  return card.translationsAcceptedAt ?? card._creationTime;
}

/** The fields the two row shapes share, which is all a card reader needs. */
export type ServedTranslationRow = Pick<
  Doc<'translations'>,
  | 'translatedText'
  | 'romanizedText'
  | 'romanizationSource'
  | 'ipaText'
  | 'ipaSource'
  | 'furiganaText'
  | 'furiganaSource'
  | 'translationSource'
  | 'regionVariant'
  | 'speakerGender'
  | 'translationVersion'
>;

export type ServedTranslation = {
  /** The live row for (text, language). */
  live: Doc<'translations'>;
  /**
   * What the card shows: the live row, or the archived revision that was
   * live at the card's pin.
   */
  row: ServedTranslationRow;
  /** True iff `row` is an archive row, i.e. the curriculum has moved on. */
  archived: boolean;
  /**
   * Identity of the served revision (the archive row's id, or the live row's),
   * for callers that memoize per revision.
   */
  revisionId: Id<'translations'> | Id<'translationArchive'>;
  /**
   * For an archived row: the asset that speaks its wording, when the
   * language had audio at the time. The card plays this instead of the live
   * row's pointer. Undefined for live rows (use the `audioRecordings` row)
   * and for archived rows that never had audio.
   */
  audioAssetId: Id<'audioAssets'> | undefined;
};

/** Raw live-row read; the one index read the accessors below build on. */
export async function getLiveTranslation(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'translations'> | null> {
  return ctx.db
    .query('translations')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('targetLanguage', targetLanguage),
    )
    .first();
}

/**
 * Pick the revision a card pinned at `pinAt` is served, given the live row.
 * Costs nothing unless the row has been archived since the pin: only then is
 * the archive consulted, for the earliest revision superseded after the pin,
 * which is the one that was live at that instant (or, for a card older than
 * the row's first wording, the first wording it was ever shown).
 *
 * `pinAt` undefined means "the live row", for readers without a card.
 */
export async function resolveServedFromLive(
  ctx: ContentCtx,
  live: Doc<'translations'>,
  pinAt: number | undefined,
): Promise<ServedTranslation> {
  if (
    pinAt === undefined ||
    live.lastArchivedAt === undefined ||
    live.lastArchivedAt <= pinAt
  ) {
    return {
      live,
      row: live,
      archived: false,
      revisionId: live._id,
      audioAssetId: undefined,
    };
  }
  const archived = await ctx.db
    .query('translationArchive')
    .withIndex('by_text_language_supersededAt', (q) =>
      q
        .eq('textId', live.textId)
        .eq('targetLanguage', live.targetLanguage)
        .gt('supersededAt', pinAt),
    )
    .order('asc')
    .first();
  if (!archived) {
    return {
      live,
      row: live,
      archived: false,
      revisionId: live._id,
      audioAssetId: undefined,
    };
  }
  return {
    live,
    row: archived,
    archived: true,
    revisionId: archived._id,
    audioAssetId: archived.audioAssetId,
  };
}

/** `getLiveTranslation` + `resolveServedFromLive` in one call. */
export async function resolveServedTranslation(
  ctx: ContentCtx,
  args: {
    textId: Id<'texts'>;
    targetLanguage: string;
    pinAt: number | undefined;
  },
): Promise<ServedTranslation | null> {
  const live = await getLiveTranslation(ctx, args.textId, args.targetLanguage);
  if (!live) return null;
  return resolveServedFromLive(ctx, live, args.pinAt);
}

/** The served wording alone, for readers that only need the text. */
export async function servedTranslatedText(
  ctx: ContentCtx,
  args: {
    textId: Id<'texts'>;
    targetLanguage: string;
    pinAt: number | undefined;
  },
): Promise<string | null> {
  const served = await resolveServedTranslation(ctx, args);
  return served ? served.row.translatedText : null;
}
