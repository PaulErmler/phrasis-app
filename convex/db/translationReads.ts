import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  accentRowLanguage,
  getMixedAccentTextLanguage,
} from '../../lib/languages';
import {
  resolveCardRendering,
  textRenderingKey,
  type CardRendering,
  type RenderingText,
} from '../../lib/preferenceResolution';

type ContentCtx = QueryCtx | MutationCtx;

/**
 * Card-facing translation and audio reads, and the ONLY module that queries
 * the `translations.by_text_language_supersededAt`,
 * `translations.by_textId_supersededAt` and
 * `audioRecordings.by_text_and_language` indexes
 * (convex/tests/lib/translationsIndexInvariant.test.ts enforces that).
 *
 * A curriculum translation row is shared by every learner's card for that
 * text. There is ONE live row per (text, language), stamped with the voice
 * it was written for (`variantKey`, lib/preferenceResolution.ts). What
 * varies between two learners' cards is the REVISION: when a version bump
 * regenerates the wording, the previous wording is copied into a second row
 * with `supersededAt` set (see schema.ts) and the live row remembers
 * `lastArchivedAt`. A card is served the wording that was live at its PIN:
 * `translationsAcceptedAt` when set, else `_creationTime`. So an existing
 * learner keeps seeing (and hearing) exactly what they learned, with zero
 * per-card writes.
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
 * The live row of (text, language): the one without `supersededAt`. The
 * explicit `.eq('supersededAt', undefined)` is what keeps a superseded
 * revision from ever being read as the live row.
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
 * The live rows of a text across languages, at most `limit` of
 * them. For readers that list a text's translations without naming a
 * language (the admin content view, the e2e flag probe).
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
 * A (text, language) range is one live row plus one superseded row
 * per version bump whose wording differed, so it is a handful at most. The
 * cap only bounds the read for the guideline's sake; a text would need 31
 * bumps to reach it.
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
  /** The live row of (text, language). */
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

// ------------------------------------------------------------- audio rows

/** The audio pointer of (text, language), stamped with the text's voice. */
export async function audioPointer(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<Doc<'audioRecordings'> | null> {
  return ctx.db
    .query('audioRecordings')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .first();
}

/**
 * Every audio pointer of (text, language). One under the invariant; the
 * cascades and deletes read the range so a stray row from an older build is
 * cleaned up too. Point reads use `audioPointer`.
 */
export async function audioPointersForTextLanguage(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<Doc<'audioRecordings'>[]> {
  return ctx.db
    .query('audioRecordings')
    .withIndex('by_text_and_language', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .take(64);
}

// ---------------------------------------------------------- what a card sees

/**
 * What a reader sees of a card. Two per-card choices decide a read: the pin
 * (`cardPinAt`) picks which superseded revision, and the accent the card's
 * text speaks in (`cards.accentLanguage`) picks which row stands in for the
 * source text. `null`, or a view marked `cardless`, is a reader with no
 * card, such as the collection preview, the placement test or the level
 * picker. Those get the live rows and the accent row a card created now
 * would store.
 */
export type SourceView = {
  pinAt?: number;
  accentLanguage?: string;
  /**
   * Set only by `previewView`: a reader with NO card, which takes the accent
   * row a card created now would store rather than one the card chose.
   */
  cardless?: true;
};

/** The `SourceView` of an existing card. */
export function viewOfCard(
  card: Pick<
    Doc<'cards'>,
    '_creationTime' | 'translationsAcceptedAt' | 'accentLanguage'
  >,
): SourceView {
  return { pinAt: cardPinAt(card), accentLanguage: card.accentLanguage };
}

/**
 * What the content sweep needs of a cards row: the accent row its source
 * slot reads (`cards.accentLanguage`), so the source clip it voices is the
 * one the card plays.
 */
export type SweepCard = { accentLanguage?: string };

/** The `SweepCard` view of a cards row. */
export function renderingCardOf(
  card: Pick<Doc<'cards'>, 'accentLanguage'>,
): SweepCard {
  return { accentLanguage: card.accentLanguage };
}

/**
 * The `SourceView` of a reader with no card: what a card created now would
 * be served (the collection preview, the warm sweeps).
 */
export function previewView(): SourceView {
  return { cardless: true };
}

/** The `RenderingText` view of a texts row. */
export function renderingTextOf(
  text: Pick<
    Doc<'texts'>,
    'speakerGender' | 'audioSpeakerGender' | 'userCreated' | 'metadataSource'
  >,
): RenderingText {
  return {
    speakerGender: text.speakerGender,
    audioSpeakerGender: text.audioSpeakerGender,
    userCreated: text.userCreated,
    metadataSource: text.metadataSource,
  };
}

/**
 * The voice a text renders in, and the key its rows and clips carry. The
 * same answer for every language of the text and for every reader, with or
 * without a card.
 */
export type TextRendering = CardRendering & { key: string };

export function renderingOfText(
  text: RenderingText,
  textId: Id<'texts'>,
): TextRendering {
  const { voiceGender } = resolveCardRendering({ text, textId });
  return { voiceGender, key: textRenderingKey({ text, textId }) };
}

export type ServedRendering = {
  /** The row the card shows, pin-resolved; null = none yet. */
  served: ServedTranslation | null;
  rendering: TextRendering;
};

/**
 * The translation a view is served for one language: the live row of
 * (text, language), pinned to the revision the card learned.
 */
export async function resolveServedRendering(
  ctx: ContentCtx,
  args: {
    textId: Id<'texts'>;
    targetLanguage: string;
    text: RenderingText;
    view: SourceView | null;
  },
): Promise<ServedRendering> {
  const live = await liveTranslation(ctx, args.textId, args.targetLanguage);
  return {
    served: live
      ? await resolveServedFromLive(ctx, live, args.view?.pinAt)
      : null,
    rendering: renderingOfText(args.text, args.textId),
  };
}

/**
 * The accent-variant row a mixed-accent course (`en`) shows in place of the
 * source wording for this text, or undefined when it shows the source text
 * itself. A card reads the row of the accent it stored at creation. In
 * `accentRowLanguage`, `en_gb` and `en_au` carry their own wording, while
 * `en_us` and a card without the field read the catalogue. So no existing
 * card ever changes wording. A reader with no card takes the row a new card
 * would store, from the text's voice hash (`getMixedAccentTextLanguage`).
 * A user-created text is always shown as typed.
 */
export function servedAccentRow(
  text: Pick<Doc<'texts'>, '_id' | 'language' | 'userCreated'>,
  view: SourceView | null,
): string | undefined {
  if (text.userCreated) return undefined;
  if (view && !view.cardless) return accentRowLanguage(view.accentLanguage);
  return getMixedAccentTextLanguage(text.language, text._id);
}

/**
 * The row language a card reads for the course language `lang`. The accent
 * row when `lang` is the text's own language and the card has one, else
 * `lang` itself.
 */
export function cardRowLanguage(
  text: Pick<Doc<'texts'>, '_id' | 'language' | 'userCreated'>,
  view: SourceView | null,
  lang: string,
): string {
  if (lang !== text.language) return lang;
  return servedAccentRow(text, view) ?? lang;
}

/**
 * The row languages a card shows for a course, deduped. These are the
 * course languages with the text's own language replaced by its accent row
 * when the card has one. Flag, edit, regenerate-audio, chat and the audit
 * all iterate this list, so to every one of them the accent row is a
 * translation row like any other and none re-derives the rule.
 */
export function cardRowLanguages(
  text: Pick<Doc<'texts'>, '_id' | 'language' | 'userCreated'>,
  view: SourceView | null,
  courseLanguages: string[],
): string[] {
  return [
    ...new Set(
      courseLanguages.map((lang) => cardRowLanguage(text, view, lang)),
    ),
  ];
}

/**
 * What a course shows for the text's own language. `text` is the wording;
 * `language` names the rows that voice and annotate it, which audio lookups
 * key on while user-facing labels keep the text's language. Either the
 * accent row is served, and `language` is the accent code, or the source
 * text is shown and `served` is null.
 */
export type ServedSourceText = {
  text: string;
  language: string;
  romanizedText: string | undefined;
  ipaText: string | undefined;
  furiganaText: string | undefined;
} & ({ served: ServedTranslation } | { served: null });

/**
 * What a course shows for the text's OWN language. The source text, except
 * when `servedAccentRow` names an accent row. Then it is that row's served
 * revision, pin-aware like any translation, with the source text as the
 * fallback while the row has not landed. Every reader that renders,
 * indexes, compares or counts the source-language side of a card goes
 * through here, so all of them agree with the card. Never a wording
 * variant: the source text is the wording. Only its voice can follow the
 * card (`sourceRenderingForView`), which is the audio readers' business.
 */
export async function servedSourceText(
  ctx: ContentCtx,
  text: Doc<'texts'>,
  view: SourceView | null,
): Promise<ServedSourceText> {
  const accent = servedAccentRow(text, view);
  if (accent !== undefined) {
    const live = await liveTranslation(ctx, text._id, accent);
    const served = live
      ? await resolveServedFromLive(ctx, live, view?.pinAt)
      : null;
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
