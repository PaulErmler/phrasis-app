import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  getMixedAccentTextLanguage,
  getMixedAccentTextSince,
} from '../../lib/languages';

type ContentCtx = QueryCtx | MutationCtx;

/**
 * Card-facing translation reads, and the ONLY module that queries the
 * `translations.by_text_language_supersededAt` and
 * `translations.by_textId_supersededAt` indexes
 * (convex/tests/lib/translationsIndexInvariant.test.ts enforces that).
 *
 * A curriculum translation row is shared by every learner's card for that
 * text. When a version bump regenerates the row's wording, the previous
 * wording is copied into a second row of the same table with `supersededAt`
 * set (see schema.ts) and the live row remembers `lastArchivedAt`. A card is
 * served the wording that was live at its PIN: `translationsAcceptedAt` when
 * set, else `_creationTime`. So an existing learner keeps seeing (and
 * hearing) exactly what they learned, while a card added later gets the new
 * wording, with zero per-card writes.
 *
 * Every reader that shows a translation ON A CARD goes through
 * `resolveServedTranslation` / `resolveServedFromLive` with the card's pin.
 * Readers with no card in hand (collection preview, placement test, the
 * content pipeline itself) read the live row through `liveTranslation`: they
 * describe the curriculum, not a learner's card. Sweeps that must reach the
 * superseded revisions too (annotation fills, audio repair) read the whole
 * range through `translationRevisions`. Readers that list a text's live
 * rows without naming a language use `liveTranslationsForText`.
 */

/** The instant a card's translations are pinned to. */
export function cardPinAt(
  card: Pick<Doc<'cards'>, '_creationTime' | 'translationsAcceptedAt'>,
): number {
  return card.translationsAcceptedAt ?? card._creationTime;
}

/** True iff `row` is a superseded revision rather than the live row. */
export function isSupersededRow(
  row: Pick<Doc<'translations'>, 'supersededAt'>,
): boolean {
  return row.supersededAt !== undefined;
}

/**
 * The live row for (text, language): the one without `supersededAt`. Convex
 * orders `undefined` before every other value, so it is the first row of the
 * index range anyway; the explicit `.eq(undefined)` is what keeps a
 * superseded row from ever being read as live, whatever the order.
 */
export async function liveTranslation(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'translations'> | null> {
  return ctx.db
    .query('translations')
    .withIndex('by_text_language_supersededAt', (q) =>
      q
        .eq('textId', textId)
        .eq('targetLanguage', targetLanguage)
        .eq('supersededAt', undefined),
    )
    .first();
}

/**
 * The live rows of a text across languages, at most `limit` of them. For
 * readers that list a text's translations without naming a language (the
 * admin content view, the e2e flag probe).
 */
export async function liveTranslationsForText(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  limit: number,
): Promise<Doc<'translations'>[]> {
  return ctx.db
    .query('translations')
    .withIndex('by_textId_supersededAt', (q) =>
      q.eq('textId', textId).eq('supersededAt', undefined),
    )
    .take(limit);
}

/**
 * A (text, language) range is one live row plus one superseded row per
 * version bump whose wording differed, so it is a handful at most. The cap
 * only bounds the read for the guideline's sake; a text would need 31 bumps
 * to reach it.
 */
const MAX_TRANSLATION_REVISIONS = 32;

/**
 * Every row of (text, language): the live row first (when one exists), then
 * the superseded revisions, oldest-superseded first. For the sweeps that
 * treat superseded revisions as content in their own right.
 */
export async function translationRevisions(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'translations'>[]> {
  return ctx.db
    .query('translations')
    .withIndex('by_text_language_supersededAt', (q) =>
      q.eq('textId', textId).eq('targetLanguage', targetLanguage),
    )
    .order('asc')
    .take(MAX_TRANSLATION_REVISIONS);
}

/** Split a `translationRevisions` range into the live row and the rest. */
export function splitRevisions(rows: Doc<'translations'>[]): {
  live: Doc<'translations'> | null;
  superseded: Doc<'translations'>[];
} {
  let live: Doc<'translations'> | null = null;
  const superseded: Doc<'translations'>[] = [];
  for (const row of rows) {
    if (isSupersededRow(row)) superseded.push(row);
    else live = row;
  }
  return { live, superseded };
}

export type ServedTranslation = {
  /** The live row for (text, language). */
  live: Doc<'translations'>;
  /**
   * What the card shows: the live row, or the superseded revision that was
   * live at the card's pin.
   */
  row: Doc<'translations'>;
  /** True iff `row` is a superseded revision, i.e. the curriculum moved on. */
  archived: boolean;
  /** Identity of the served revision, for callers that memoize per revision. */
  revisionId: Id<'translations'>;
  /**
   * For a superseded revision: the asset that speaks its wording. The card
   * plays this instead of the live row's pointer. Undefined for the live row
   * (use the `audioRecordings` row).
   */
  audioAssetId: Id<'audioAssets'> | undefined;
};

function servedLive(live: Doc<'translations'>): ServedTranslation {
  return {
    live,
    row: live,
    archived: false,
    revisionId: live._id,
    audioAssetId: undefined,
  };
}

/**
 * Pick the revision a card pinned at `pinAt` is served, given the live row.
 * Costs nothing unless the row has been archived since the pin: only then is
 * the index consulted, for the earliest revision superseded after the pin,
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
    return servedLive(live);
  }
  const archived = await ctx.db
    .query('translations')
    .withIndex('by_text_language_supersededAt', (q) =>
      q
        .eq('textId', live.textId)
        .eq('targetLanguage', live.targetLanguage)
        .gt('supersededAt', pinAt),
    )
    .order('asc')
    .first();
  // No row, or a row without audio (never written by the current pipeline,
  // which only archives spoken wordings; guards rows from before that rule):
  // serve live rather than pin the card to a wording nothing voices.
  if (!archived || archived.audioAssetId === undefined) {
    return servedLive(live);
  }
  return {
    live,
    row: archived,
    archived: true,
    revisionId: archived._id,
    audioAssetId: archived.audioAssetId,
  };
}

/** `liveTranslation` + `resolveServedFromLive` in one call. */
export async function resolveServedTranslation(
  ctx: ContentCtx,
  args: {
    textId: Id<'texts'>;
    targetLanguage: string;
    pinAt: number | undefined;
  },
): Promise<ServedTranslation | null> {
  const live = await liveTranslation(ctx, args.textId, args.targetLanguage);
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

/**
 * The accent-variant row a mixed-accent course (`en`) shows in place of the
 * source wording for this text, or undefined when the course shows the
 * source text itself. A British-voiced curriculum text reads the `en_gb`
 * rewrite, an Australian one `en_au` (`getMixedAccentTextLanguage`), so the
 * learner reads what they hear. Three cases keep the source wording: a
 * user-created text (the wording is the user's), a language with no
 * cutover, and a card pinned before the cutover
 * (`Language.mixedAccentTextSince`): the learner keeps the wording and
 * audio they learned, exactly as a version bump keeps a pinned card on its
 * archived revision. `pinAt` undefined (a reader with no card) reads the
 * accent row. Data-driven: any language whose variants declare
 * `accentRewrite` and that sets a cutover behaves the same.
 */
export function mixedAccentRowLanguage(
  input: {
    userCreated: boolean;
    pinAt?: number | undefined;
    textId: Id<'texts'>;
  },
  lang: string,
): string | undefined {
  if (input.userCreated) return undefined;
  const since = getMixedAccentTextSince(lang);
  if (since === undefined) return undefined;
  if (input.pinAt !== undefined && input.pinAt < since) return undefined;
  return getMixedAccentTextLanguage(lang, input.textId);
}

export type ServedSourceText = {
  /** The wording shown for the text's own language. */
  text: string;
  /**
   * The language whose rows voice and annotate that wording: the accent
   * code when an accent row is served, else the text's own language. Audio
   * lookups key on it; user-facing labels keep the text's language.
   */
  language: string;
  romanizedText: string | undefined;
  ipaText: string | undefined;
  furiganaText: string | undefined;
  /** The accent row when one is served, for callers that key on revisions. */
  served: ServedTranslation | null;
};

/**
 * What a course shows for the text's OWN language. The source text, except
 * on a mixed-accent course where `mixedAccentRowLanguage` names an accent
 * row: then that row's served revision (pin-aware like any translation),
 * with the source text as the fallback while the row has not landed. Every
 * reader that renders, indexes, compares or counts the source-language
 * side of a card goes through here, so all of them agree with the card.
 */
export async function servedSourceText(
  ctx: ContentCtx,
  text: Doc<'texts'>,
  pinAt: number | undefined,
): Promise<ServedSourceText> {
  const accent = mixedAccentRowLanguage(
    { userCreated: text.userCreated, pinAt, textId: text._id },
    text.language,
  );
  if (accent !== undefined) {
    const served = await resolveServedTranslation(ctx, {
      textId: text._id,
      targetLanguage: accent,
      pinAt,
    });
    if (served) {
      return {
        text: served.row.translatedText,
        language: accent,
        romanizedText: served.row.romanizedText,
        ipaText: served.row.ipaText,
        furiganaText: served.row.furiganaText,
        served,
      };
    }
  }
  return {
    text: text.text,
    language: text.language,
    romanizedText: text.romanizedText,
    ipaText: text.ipaText,
    furiganaText: text.furiganaText,
    served: null,
  };
}

/**
 * The wording a course language shows for a text: `servedSourceText` for
 * the text's own language, the served translation otherwise (null while it
 * is missing).
 */
export async function servedTextForLanguage(
  ctx: ContentCtx,
  text: Doc<'texts'>,
  lang: string,
  pinAt: number | undefined,
): Promise<string | null> {
  if (lang === text.language)
    return (await servedSourceText(ctx, text, pinAt)).text;
  return servedTranslatedText(ctx, {
    textId: text._id,
    targetLanguage: lang,
    pinAt,
  });
}
