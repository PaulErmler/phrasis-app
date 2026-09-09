import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  accentRowLanguage,
  getMixedAccentTextLanguage,
} from '../../lib/languages';
import {
  AUTO,
  axisOf,
  hasRenderingOverride,
  parseVariantKey,
  resolveCardRendering,
  resolveLanguageRendering,
  resolveSourceRendering,
  type LanguageRendering,
  type RenderingCard,
  type RenderingSettings,
  type RenderingText,
} from '../../lib/preferenceResolution';
import { getPolitenessConfig } from '../../lib/languageForms';
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
 * 1. The REVISION. When a version bump regenerates the row's wording, the
 *    previous wording is copied into a second row with `supersededAt` set
 *    (see schema.ts) and the live row remembers `lastArchivedAt`. A card is
 *    served the wording that was live at its PIN: `translationsAcceptedAt`
 *    when set, else `_creationTime`. So an existing learner keeps seeing
 *    (and hearing) exactly what they learned, with zero per-card writes.
 * 2. The RENDERING VARIANT. A course's sentence-form settings
 *    (first-person forms, politeness levels) resolve, per language, to a
 *    `variantKey` (lib/preferenceResolution.ts); rows carrying it are a
 *    second rendering of the same text. Canonical rows have no key. See
 *    docs/architecture/translation-variants.md.
 *
 * Every point read pins ALL index columns: a prefix query plus `.first()`
 * returns whichever row was created first, which is the silent
 * wrong-rendering bug. Readers with no card in hand (collection preview,
 * placement test, the content pipeline itself) read the live canonical row
 * through `liveTranslation`; sweeps that must reach superseded revisions
 * read the range through `translationRevisions`.
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
 * The live row for (text, language, variant): the one without
 * `supersededAt`. Convex orders `undefined` before every other value, so it
 * is the first row of the index range anyway; the explicit `.eq(undefined)`
 * on both `variantKey` and `supersededAt` is what keeps a variant or a
 * superseded row from ever being read as the canonical live row.
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
 * The live CANONICAL rows of a text across languages, at most `limit` of
 * them. For readers that list a text's translations without naming a
 * language (the admin content view, the e2e flag probe). Variant rows are
 * filtered out after the index scan; a text has a handful of them at most.
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
    .filter((q) => q.eq(q.field('variantKey'), undefined))
    .take(limit);
}

/**
 * A (text, language, variant) range is one live row plus one superseded row
 * per version bump whose wording differed, so it is a handful at most. The
 * cap only bounds the read for the guideline's sake; a text would need 31
 * bumps to reach it.
 */
const MAX_TRANSLATION_REVISIONS = 32;

/**
 * Every row of (text, language, variant): the live row first (when one
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

/**
 * Every VARIANT row of (text, language), live and superseded, whatever the
 * key: the range past the canonical rows. For cascades and sweeps that
 * must reach variants (delete a text, retire a language).
 */
export async function variantTranslationsForTextLanguage(
  ctx: ContentCtx,
  textId: Id<'texts'>,
  targetLanguage: string,
): Promise<Doc<'translations'>[]> {
  return ctx.db
    .query('translations')
    .withIndex('by_text_language_variant_supersededAt', (q) =>
      q
        .eq('textId', textId)
        .eq('targetLanguage', targetLanguage)
        .gt('variantKey', ''),
    )
    .take(MAX_TRANSLATION_REVISIONS * 4);
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
  /** The live row for (text, language, variant). */
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

/** `liveTranslation` + `resolveServedFromLive` in one call (canonical). */
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

// ------------------------------------------------------------- audio rows

/**
 * The audio pointer for (text, language, variant). `variantKey` undefined is
 * the canonical pointer, spoken in the text's coin-flipped voice; a key is a
 * specific voice and politeness form (`audioVariantKey` in
 * lib/preferenceResolution.ts).
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
 * Every audio pointer of (text, language): the canonical one and every
 * variant. For deletes and cascades; point reads use `audioPointer`.
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
 * source text, and the course's sentence-form settings, when the card
 * follows them (`cards.followsCoursePreferences`), pick the rendering
 * variant per language. `null` is a reader with no card, such as the
 * collection preview, the placement test or the level picker. Those get the
 * live rows, the accent row a card created now would store and, when
 * `previewView` supplied the settings, the rendering a new card would get.
 */
export type SourceView = {
  pinAt?: number;
  accentLanguage?: string;
  /** The course's sentence-form settings; absent = canonical renderings. */
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
    // A per-card correction renders even on a course without settings; the
    // resolver needs a settings object to read the politeness levels from,
    // so an empty one stands in.
    settings: settings ?? (hasRenderingOverride(card) ? {} : undefined),
    card: renderingCardOf(card),
  };
}

/**
 * The `RenderingCard` of a cards row, plus the accent row its source slot
 * reads (`cards.accentLanguage`). The resolver ignores the accent; the
 * rendering sweep needs it so the source clip it voices is the one the
 * card plays (`scheduleMissingRenderings`).
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
 * The `SourceView` of a reader with no card that still wants the rendering
 * a card created now would get (the collection preview on a course with
 * settings). Without settings it equals `null`.
 */
export function previewView(
  settings: RenderingSettings | null | undefined,
): SourceView | null {
  return settings ? { settings, card: null } : null;
}

/**
 * The settings a course settings document carries for the resolver. Only
 * the politeness levels: `firstPersonForms` is still stored (the course
 * gender choice was withdrawn on 2026-09-08) but nothing reads it.
 */
export function renderingSettingsOf(
  settings: Pick<Doc<'courseSettings'>, 'politenessLevels'> | null | undefined,
): RenderingSettings | undefined {
  if (!settings) return undefined;
  if (settings.politenessLevels === undefined) return undefined;
  return { politenessLevels: settings.politenessLevels };
}

/** The rendering of a reader with no settings: every axis canonical. */
export const CANONICAL_RENDERING: LanguageRendering = {
  form: null,
  textVariantKey: null,
  audioVariantKey: null,
  voiceGender: 'male',
};

/** The `RenderingText` view of a texts row. */
export function renderingTextOf(
  text: Pick<
    Doc<'texts'>,
    | 'speakerGender'
    | 'audioSpeakerGender'
    | 'addressesSomeone'
    | 'addresseeNumber'
    | 'userCreated'
    | 'metadataSource'
  >,
): RenderingText {
  return {
    speakerGender: text.speakerGender,
    audioSpeakerGender: text.audioSpeakerGender,
    addressesSomeone: text.addressesSomeone,
    addresseeNumber: text.addresseeNumber,
    userCreated: text.userCreated,
    metadataSource: text.metadataSource,
  };
}

/**
 * The rendering a view reads for one language of a text: the two variant
 * keys and the voice. Canonical (null keys) whenever the view carries no
 * settings, the card does not follow them, or the text is user-written.
 * `voiceGender` is only meaningful when a key is set.
 *
 * `regionVariant` is the canonical row's dialect pin when `language` is a
 * mixed code (`es_mixed`): Spain and Latin America map the levels onto
 * their forms differently, so the row's own dialect decides the form. Before
 * the canonical row exists the language's default dialect stands in, which
 * only ever affects a key nothing has been generated under yet.
 */
export function renderingForView(
  view: SourceView | null,
  text: RenderingText,
  textId: Id<'texts'>,
  language: string,
  regionVariant?: string,
): LanguageRendering {
  if (!view?.settings) return CANONICAL_RENDERING;
  const card = view.card ?? null;
  const cardRendering = resolveCardRendering({
    text,
    textId,
    settings: view.settings,
    card,
  });
  return resolveLanguageRendering({
    card: cardRendering,
    code: classificationLanguageForRow({
      targetLanguage: language,
      regionVariant,
    }),
    text,
    textId,
    settings: view.settings,
    cardRow: card,
  });
}

/**
 * The rendering a view reads for the text's OWN language: never a wording
 * variant (the source text is the wording), only the card's voice when it
 * differs from the canonical clip's. The accent row of a Mixed English card
 * reads the same rendering, since it is a rewrite of the source, not of a
 * form.
 */
export function sourceRenderingForView(
  view: SourceView | null,
  text: RenderingText,
  textId: Id<'texts'>,
): LanguageRendering {
  if (!view?.settings) return CANONICAL_RENDERING;
  return resolveSourceRendering(
    resolveCardRendering({
      text,
      textId,
      settings: view.settings,
      card: view.card ?? null,
    }),
  );
}

/**
 * The voice every language of the card is spoken in, for the gender chip:
 * the text's own voice, or the card's Flag-dialog correction. Defined for
 * every reader, settings or not, since every card has a voice.
 */
export function cardVoiceForView(
  view: SourceView | null,
  text: RenderingText,
  textId: Id<'texts'>,
): 'male' | 'female' {
  return resolveCardRendering({
    text,
    textId,
    settings: view?.settings ?? {},
    card: view?.card ?? null,
  }).voiceGender;
}

/**
 * Whether a canonical row, by its classifier stamps, already IS the
 * requested rendering on every axis the text key asks for, so no variant
 * row is needed: the reader serves canonical and the ensure path schedules
 * nothing. An unstamped row never satisfies anything (the backfill has not
 * reached it). A gender stamp of 'unmarked' satisfies a gender request: the
 * wording has no first-person marking to rewrite, only the voice can
 * differ, and that is the audio key's business.
 */
export function canonicalSatisfies(
  canonical: Pick<
    Doc<'translations'>,
    'targetLanguage' | 'regionVariant' | 'renderedGender' | 'renderedPoliteness'
  >,
  rendering: LanguageRendering,
): boolean {
  if (rendering.textVariantKey === null) return true;
  const { gender, formId } = parseVariantKey(rendering.textVariantKey);
  if (gender !== AUTO) {
    if (
      canonical.renderedGender !== axisOf(gender) &&
      canonical.renderedGender !== 'unmarked'
    ) {
      return false;
    }
  }
  if (formId !== AUTO) {
    const form = rendering.form;
    if (!form || canonical.renderedPoliteness === undefined) return false;
    // The stamp is a global level; the form it names must be the requested
    // one (a tu sentence satisfies both "casual" and "polite" on Spain
    // Spanish). Looked up through the row's own dialect, like the stamp.
    const config = getPolitenessConfig(classificationLanguageForRow(canonical));
    if (!config) return false;
    if (canonical.renderedPoliteness === 'unmarked') {
      // An ADDRESS language marks politeness only through the word for
      // "you", so a wording the classifier stamped `unmarked` has nothing a
      // rewrite could change: "Hola." is the same sentence at tú and at
      // usted, and the canonical row already IS every form. Treating that
      // as a gap made every such sentence sit on "updating" for good in the
      // preview and buy one LLM rewrite per card to rediscover it
      // (2026-09-09, the pre-A1 greetings).
      //
      // The other markings are a real gap: a predicate, particle or pronoun
      // language can have its carrier ADDED by a rewrite (Thai gaining
      // ครับ, Japanese gaining です・ます), so `unmarked` there means the
      // form is genuinely absent and worth asking for. Same shape as the
      // gender axis above, where `unmarked` always satisfies because no
      // rewrite can introduce first-person marking that is not there.
      if (config.marking !== 'address') return false;
    } else if (config.forms[canonical.renderedPoliteness].id !== form.id) {
      return false;
    }
  }
  return true;
}

export type ServedRendering = {
  /** The row the card shows, canonical or variant, pin-resolved; null = none yet. */
  served: ServedTranslation | null;
  rendering: LanguageRendering;
  /**
   * The view wants a text variant that has not landed yet (the card shows
   * canonical meanwhile). A stored variant marked `sameAsCanonical` is not
   * missing: the canonical wording IS the variant.
   */
  textVariantMissing: boolean;
};

/**
 * The translation a view is served for one language: the variant row when
 * the view resolves to one and it has landed with its own wording, else
 * the canonical row. Both are pin-aware like any translation.
 *
 * The pin outranks the variant. A card pinned to an archived revision is
 * served that wording as it was; the variants are rewrites of the LIVE
 * wording (a bump retires them, `retireVariantRenderings`), so serving one
 * would move the card onto the new wording through the back door, and
 * asking for one would buy a rewrite the card never shows.
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
  const canonical = await liveTranslation(
    ctx,
    args.textId,
    args.targetLanguage,
  );
  const rendering = renderingForView(
    args.view,
    args.text,
    args.textId,
    args.targetLanguage,
    canonical?.regionVariant,
  );
  const servedCanonical = canonical
    ? await resolveServedFromLive(ctx, canonical, pinAt)
    : null;
  if (rendering.textVariantKey === null || servedCanonical?.archived) {
    return { served: servedCanonical, rendering, textVariantMissing: false };
  }
  const variant = await liveTranslation(
    ctx,
    args.textId,
    args.targetLanguage,
    rendering.textVariantKey,
  );
  if (variant && !variant.sameAsCanonical) {
    return {
      served: await resolveServedFromLive(ctx, variant, pinAt),
      rendering,
      textVariantMissing: false,
    };
  }
  return {
    served: servedCanonical,
    rendering,
    textVariantMissing:
      variant === null &&
      !(canonical !== null && canonicalSatisfies(canonical, rendering)),
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
    const served = await resolveServedTranslation(ctx, {
      textId: text._id,
      targetLanguage: accent,
      pinAt: view?.pinAt,
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
