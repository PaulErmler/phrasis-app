import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  accentRowLanguage,
  getMixedAccentTextLanguage,
  isMixedLanguage,
  pickMixedVariantForNewRow,
  resolveMixedVariant,
} from '../../lib/languages';
import {
  cardAcceptsLegacyRow,
  primaryRenderingKey,
  resolveCardRendering,
  resolveLanguageRendering,
  resolveSourceRendering,
  type CardRendering,
  type LanguageRendering,
  type RenderingCard,
  type RenderingSettings,
  type RenderingText,
} from '../../lib/preferenceResolution';
import { classificationLanguageForRow } from '../lib/renderingClassifier';

type ContentCtx = QueryCtx | MutationCtx;

/**
 * Card-facing translation and audio reads, and the ONLY module that queries
 * the `translations.by_text_language_variant_supersededAt`,
 * `translations.by_textId_supersededAt` and
 * `audioRecordings.by_text_language_variant` indexes
 * (convex/tests/lib/translationsIndexInvariant.test.ts enforces that).
 *
 * A curriculum translation row is shared by every learner's card for that
 * text. Two things decide which row a card reads:
 *
 * 1. The RENDERING KEY, `"<male|female>|<formId|none>"` on `variantKey`
 *    (lib/preferenceResolution.ts, docs/architecture/rendering-keys.md).
 *    Every row written since the cutover carries one: the voice and the
 *    politeness form it was generated for. Rows with no key are LEGACY rows
 *    from before; they are never generated again and are served only to
 *    cards that do not follow the settings (`viewAcceptsLegacyRow`), and as
 *    a placeholder to a settings-following card whose keyed row is still
 *    being made.
 * 2. The REVISION. When a version bump regenerates the row's wording, the
 *    previous wording is copied into a second row with `supersededAt` set
 *    (see schema.ts) and the live row remembers `lastArchivedAt`. A card is
 *    served the wording that was live at its PIN: `translationsAcceptedAt`
 *    when set, else `_creationTime`. So an existing learner keeps seeing
 *    (and hearing) exactly what they learned, with zero per-card writes.
 *    The pin applies within a key.
 *
 * Every point read pins ALL index columns: a prefix query plus `.first()`
 * returns whichever row was created first, which is the silent
 * wrong-rendering bug.
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
 * The live row for (text, language, key): the one without `supersededAt`.
 * `variantKey` undefined is the LEGACY row. Convex orders `undefined` before
 * every other value, so it is the first row of the index range anyway; the
 * explicit `.eq(undefined)` on both `variantKey` and `supersededAt` is what
 * keeps a keyed or a superseded row from ever being read as the legacy live
 * row.
 */
export async function liveTranslation(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  variantKey?: string,
): Promise<Doc<'translations'> | null> {
  return ctx.db
    .query('translations')
    .withIndex('by_text_language_variant_supersededAt', (q) =>
      q
        .eq('textId', textId)
        .eq('targetLanguage', targetLanguage)
        .eq('variantKey', variantKey)
        .eq('supersededAt', undefined),
    )
    .first();
}

/**
 * The live rows of a text across languages and keys, at most `limit` of
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
 * A (text, language, key) range is one live row plus one superseded row
 * per version bump whose wording differed, so it is a handful at most. The
 * cap only bounds the read for the guideline's sake; a text would need 31
 * bumps to reach it.
 */
const MAX_TRANSLATION_REVISIONS = 32;

/**
 * Every row of (text, language, key): the live row first (when one
 * exists), then the superseded revisions, oldest-superseded first. For the
 * sweeps that treat superseded revisions as content in their own right.
 */
export async function translationRevisions(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
  variantKey?: string,
): Promise<Doc<'translations'>[]> {
  return ctx.db
    .query('translations')
    .withIndex('by_text_language_variant_supersededAt', (q) =>
      q
        .eq('textId', textId)
        .eq('targetLanguage', targetLanguage)
        .eq('variantKey', variantKey),
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
  /** The live row for (text, language, key). */
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
    .withIndex('by_text_language_variant_supersededAt', (q) =>
      q
        .eq('textId', live.textId)
        .eq('targetLanguage', live.targetLanguage)
        .eq('variantKey', live.variantKey)
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

/** `liveTranslation` + `resolveServedFromLive` in one call, for one key. */
export async function resolveServedTranslation(
  ctx: ContentCtx,
  args: {
    textId: Id<'texts'>;
    targetLanguage: string;
    pinAt: number | undefined;
    variantKey?: string;
  },
): Promise<ServedTranslation | null> {
  const live = await liveTranslation(
    ctx,
    args.textId,
    args.targetLanguage,
    args.variantKey,
  );
  if (!live) return null;
  return resolveServedFromLive(ctx, live, args.pinAt);
}

/**
 * The dialect a mixed-code row of (text, language) resolves its form under
 * (`classificationLanguageForRow`): the legacy row's pin when one exists
 * (its wording was written under it, and a keyed row inherits it), the
 * legacy coin when a legacy row predates the column, and the decorrelated
 * pick for a text with no row at all. Mirrors `resolveMixedVariantPin` in
 * the LLM worker, so the key a reader computes is the key the job writes.
 * Undefined for every non-mixed language.
 */
export function dialectForRendering(
  language: string,
  textId: Id<'texts'>,
  legacy: Pick<Doc<'translations'>, 'regionVariant'> | null,
): string | undefined {
  if (legacy?.regionVariant) return legacy.regionVariant;
  if (!isMixedLanguage(language)) return undefined;
  const pick = legacy
    ? resolveMixedVariant(language, textId as string)
    : pickMixedVariantForNewRow(language, textId as string);
  return pick?.regionVariant;
}

/**
 * The row a reader WITHOUT a card is served for one language: the primary
 * keyed row (the text's own voice and primary form), else the legacy row.
 * The placement test, the admin views and the e2e probes read this.
 */
export async function primaryOrLegacyTranslation(
  ctx: ContentCtx,
  text: Doc<'texts'>,
  targetLanguage: string,
  pinAt?: number,
): Promise<ServedTranslation | null> {
  const legacy = await liveTranslation(ctx, text._id, targetLanguage);
  const key = primaryRenderingKey({
    text: renderingTextOf(text),
    textId: text._id,
    code: classificationLanguageForRow({
      targetLanguage,
      regionVariant: dialectForRendering(targetLanguage, text._id, legacy),
    }),
  });
  const keyed = await liveTranslation(ctx, text._id, targetLanguage, key);
  const live = keyed ?? legacy;
  if (!live) return null;
  return resolveServedFromLive(ctx, live, pinAt);
}

/** The primary key of (text, language) on the row's dialect. */
export function primaryKeyForLanguage(
  text: Doc<'texts'>,
  language: string,
  regionVariant: string | undefined,
): string {
  return primaryRenderingKey({
    text: renderingTextOf(text),
    textId: text._id,
    code: classificationLanguageForRow({
      targetLanguage: language,
      regionVariant,
    }),
  });
}

/**
 * The audio pointer a reader WITHOUT a card plays for one language: the
 * pointer of the primary key when its row is served, else the legacy
 * pointer. Pairs with `primaryOrLegacyTranslation`.
 */
export async function primaryOrLegacyAudio(
  ctx: ContentCtx,
  text: Doc<'texts'>,
  language: string,
): Promise<Doc<'audioRecordings'> | null> {
  const rendering =
    language === text.language
      ? sourceRenderingForView(null, renderingTextOf(text), text._id)
      : renderingForView(
          null,
          renderingTextOf(text),
          text._id,
          language,
          dialectForRendering(
            language,
            text._id,
            await liveTranslation(ctx, text._id, language),
          ),
        );
  return (
    (await audioPointer(ctx, text._id, language, rendering.key)) ??
    (await audioPointer(ctx, text._id, language))
  );
}

// ------------------------------------------------------------- audio rows

/**
 * The audio pointer for (text, language, key). `variantKey` undefined is
 * the legacy pointer, spoken in the text's own voice; a key is a concrete
 * voice and politeness form (`LanguageRendering.key`).
 */
export async function audioPointer(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  language: string,
  variantKey?: string,
): Promise<Doc<'audioRecordings'> | null> {
  return ctx.db
    .query('audioRecordings')
    .withIndex('by_text_language_variant', (q) =>
      q
        .eq('textId', textId)
        .eq('language', language)
        .eq('variantKey', variantKey),
    )
    .first();
}

/**
 * Every audio pointer of (text, language): the legacy one and every keyed
 * one. For deletes and cascades; point reads use `audioPointer`.
 */
export async function audioPointersForTextLanguage(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  language: string,
): Promise<Doc<'audioRecordings'>[]> {
  return ctx.db
    .query('audioRecordings')
    .withIndex('by_text_language_variant', (q) =>
      q.eq('textId', textId).eq('language', language),
    )
    .take(64);
}

// ---------------------------------------------------------- what a card sees

/**
 * What a reader sees of a card. Three per-card choices decide a read. The
 * pin (`cardPinAt`) picks which superseded revision, the accent the card's
 * text speaks in (`cards.accentLanguage`) picks which row stands in for the
 * source text, and the course's politeness setting, when the card follows
 * it (`cards.followsCoursePreferences`), picks the rendering key per
 * language. `null` is a reader with no card, such as the collection
 * preview, the placement test or the level picker. Those get the live rows,
 * the accent row a card created now would store and the rendering a new
 * card would get.
 */
export type SourceView = {
  pinAt?: number;
  accentLanguage?: string;
  /** The course's politeness setting; absent = no preference. */
  settings?: RenderingSettings;
  /** The card's stamp, or null for a reader with no card. */
  card?: RenderingCard;
};

/** The `SourceView` of an existing card. */
export function viewOfCard(
  card: Pick<
    Doc<'cards'>,
    | '_creationTime'
    | 'translationsAcceptedAt'
    | 'accentLanguage'
    | 'followsCoursePreferences'
    | 'renderingGenderOverride'
    | 'renderingPolitenessOverride'
  >,
  settings?: RenderingSettings | null,
): SourceView {
  return {
    pinAt: cardPinAt(card),
    accentLanguage: card.accentLanguage,
    settings: settings ?? undefined,
    card: renderingCardOf(card),
  };
}

/**
 * The `RenderingCard` of a cards row, plus the accent row its source slot
 * reads (`cards.accentLanguage`). The resolver ignores the accent; the
 * content sweep needs it so the source clip it voices is the one the card
 * plays.
 */
export type SweepCard = NonNullable<RenderingCard> & {
  accentLanguage?: string;
};

/** The `SweepCard` view of a cards row. */
export function renderingCardOf(
  card: Pick<
    Doc<'cards'>,
    | 'followsCoursePreferences'
    | 'renderingGenderOverride'
    | 'renderingPolitenessOverride'
    | 'accentLanguage'
  >,
): SweepCard {
  return {
    followsCoursePreferences: card.followsCoursePreferences,
    renderingGenderOverride: card.renderingGenderOverride,
    renderingPolitenessOverride: card.renderingPolitenessOverride,
    accentLanguage: card.accentLanguage,
  };
}

/**
 * The `SourceView` of a reader with no card: the rendering a card created
 * now would get (the collection preview, the warm sweeps).
 */
export function previewView(
  settings: RenderingSettings | null | undefined,
): SourceView {
  return { settings: settings ?? undefined, card: null };
}

/** The settings a course settings document carries for the resolver. */
export function renderingSettingsOf(
  settings: Pick<Doc<'courseSettings'>, 'politenessLevels'> | null | undefined,
): RenderingSettings | undefined {
  if (!settings) return undefined;
  if (settings.politenessLevels === undefined) return undefined;
  return { politenessLevels: settings.politenessLevels };
}

/** The `RenderingText` view of a texts row. */
export function renderingTextOf(
  text: Pick<
    Doc<'texts'>,
    | 'speakerGender'
    | 'audioSpeakerGender'
    | 'register'
    | 'addressesSomeone'
    | 'addresseeNumber'
    | 'userCreated'
    | 'metadataSource'
  >,
): RenderingText {
  return {
    speakerGender: text.speakerGender,
    audioSpeakerGender: text.audioSpeakerGender,
    register: text.register,
    addressesSomeone: text.addressesSomeone,
    addresseeNumber: text.addresseeNumber,
    userCreated: text.userCreated,
    metadataSource: text.metadataSource,
  };
}

/**
 * Whether an unkeyed (legacy) row is THE rendering for this view
 * (`cardAcceptsLegacyRow`): a user-written text, or a card from before the
 * feature with no Flag-dialog correction. Such a view reads its legacy row
 * first and a keyed row only where it has none. Every other view reads the
 * keyed row first and is served a legacy row only as a placeholder.
 */
export function viewAcceptsLegacyRow(
  view: SourceView | null,
  text: Pick<RenderingText, 'userCreated'>,
): boolean {
  return cardAcceptsLegacyRow(text, view?.card ?? null);
}

/** The card-wide voice of a view: the text's own or the card's correction. */
export function cardRenderingForView(
  view: SourceView | null,
  text: RenderingText,
  textId: Id<'texts'>,
): CardRendering {
  return resolveCardRendering({ text, textId, card: view?.card ?? null });
}

/**
 * The rendering a view reads for one language of a text: the key and the
 * voice. Always resolved, settings or not: a view with no settings and no
 * card override reads the sentence's primary rendering.
 *
 * `regionVariant` is the row's dialect pin when `language` is a mixed code
 * (`es_mixed`): Spain and Latin America map the levels onto their forms
 * differently, so the row's own dialect decides the form
 * (`dialectForRendering`).
 */
export function renderingForView(
  view: SourceView | null,
  text: RenderingText,
  textId: Id<'texts'>,
  language: string,
  regionVariant?: string,
): LanguageRendering {
  const card = view?.card ?? null;
  return resolveLanguageRendering({
    card: cardRenderingForView(view, text, textId),
    code: classificationLanguageForRow({
      targetLanguage: language,
      regionVariant,
    }),
    text,
    textId,
    settings: view?.settings ?? {},
    cardRow: card,
  });
}

/**
 * The rendering a view reads for the text's OWN language: never a wording
 * variant (the source text is the wording), only the card's voice. The
 * accent row of a Mixed English card reads the same rendering, since it is
 * a rewrite of the source, not of a form.
 */
export function sourceRenderingForView(
  view: SourceView | null,
  text: RenderingText,
  textId: Id<'texts'>,
): LanguageRendering {
  return resolveSourceRendering(cardRenderingForView(view, text, textId));
}

export type ServedRendering = {
  /** The row the card shows, keyed or legacy, pin-resolved; null = none yet. */
  served: ServedTranslation | null;
  rendering: LanguageRendering;
  /** True when `served` is the row at the view's key. */
  servedKeyed: boolean;
  /**
   * The view's keyed row has not landed and the view does not accept a
   * legacy row: whatever `served` holds is a placeholder about to change.
   */
  textPending: boolean;
};

/**
 * The translation a view is served for one language. A view that accepts
 * legacy rows reads its legacy row, and the row at its key only where it
 * has none. Every other view reads the live row at its rendering key,
 * pinned within that key, and is served the legacy row only as a
 * placeholder, with `textPending` set, while the keyed row is made.
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
  const pinAt = args.view?.pinAt;
  const legacy = await liveTranslation(ctx, args.textId, args.targetLanguage);
  const rendering = renderingForView(
    args.view,
    args.text,
    args.textId,
    args.targetLanguage,
    dialectForRendering(args.targetLanguage, args.textId, legacy),
  );
  const acceptsLegacy = viewAcceptsLegacyRow(args.view, args.text);
  const keyed =
    acceptsLegacy && legacy
      ? null
      : await liveTranslation(
          ctx,
          args.textId,
          args.targetLanguage,
          rendering.key,
        );
  const live = acceptsLegacy ? (legacy ?? keyed) : (keyed ?? legacy);
  const servedKeyed = live !== null && live === keyed;
  return {
    served: live ? await resolveServedFromLive(ctx, live, pinAt) : null,
    rendering,
    servedKeyed,
    textPending: !acceptsLegacy && keyed === null,
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
  if (view && view.card !== null) return accentRowLanguage(view.accentLanguage);
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
 * revision, at the view's source key (the card's voice, no form) or the
 * legacy accent row, pin-aware like any translation, with the source text
 * as the fallback while the row has not landed. Every reader that renders,
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
    const key = sourceRenderingForView(view, renderingTextOf(text), text._id)
      .key;
    const legacy = await liveTranslation(ctx, text._id, accent);
    const live =
      viewAcceptsLegacyRow(view, text) && legacy
        ? legacy
        : ((await liveTranslation(ctx, text._id, accent, key)) ?? legacy);
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
