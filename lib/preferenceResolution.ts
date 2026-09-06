/**
 * Which rendering of a sentence a card is served, given the course's
 * first-person-forms and politeness settings. Pure and dependency-light so
 * the client (settings previews), the Convex readers (convex/db/
 * translationReads.ts) and the generation path (convex/lib/
 * contentScheduling.ts) all agree on one answer.
 *
 * Layers: `texts` is the identity of a meaning and carries the content
 * semantics (a definitive speaker gender, the register metadata); the
 * course settings are the preference; this module is the one resolver;
 * the `translations` / `audioRecordings` rows keyed by `variantKey` are the
 * disposable realizations. The resolver never writes anything.
 *
 * Gender is resolved ONCE per card and is the same for every language of
 * the card: the chosen forms set the voice everywhere, marked or not.
 * Politeness is resolved per language, because each language maps the
 * global levels onto its own forms.
 */

import { fnv1a } from './languages';
import {
  concreteLanguageCodes,
  getPolitenessConfig,
  languageMarksFirstPerson,
  selectedPolitenessForms,
  type PolitenessForm,
  type PolitenessLevel,
} from './languageForms';
import { resolveCardSpeakerGenders } from './voices';

export const FIRST_PERSON_FORMS = ['masculine', 'feminine', 'both'] as const;
export type FirstPersonForms = (typeof FIRST_PERSON_FORMS)[number];

/** The course-settings fields this module reads. Undefined = canonical. */
export type RenderingSettings = {
  firstPersonForms?: FirstPersonForms;
  politenessLevels?: PolitenessLevel[];
};

/** The `texts` fields this module reads. */
export type RenderingText = {
  speakerGender?: string;
  audioSpeakerGender?: string;
  addressesSomeone?: boolean;
  addresseeNumber?: string;
  userCreated: boolean;
};

/**
 * The `cards` fields this module reads. `null` is a reader with no card
 * (collection preview, placement test): it sees what a card created now
 * would get.
 */
export type RenderingCard = { followsCoursePreferences?: true } | null;

/** The gender axis of a variant key. 'auto' = as the canonical rendering. */
export type GenderAxis = 'masculine' | 'feminine' | 'auto';

export const AUTO = 'auto';

export type CardRendering = {
  /** The gender axis shared by every language of the card. */
  gender: GenderAxis;
  /** The voice every language of the card is spoken in. */
  voiceGender: 'male' | 'female';
  /** The voice the canonical (no-preference) audio is in. */
  canonicalVoiceGender: 'male' | 'female';
  /**
   * True when the card must be voiced in a gender the canonical audio is
   * not in. Unmarked languages then get an audio-only variant.
   */
  needsVoice: boolean;
};

export type LanguageRendering = {
  /** The politeness form for this language, or null for "as canonical". */
  form: PolitenessForm | null;
  /**
   * Key of the `translations` row this language reads:
   * `"<male|female|auto>|<formId|auto>"`. The gender part is the card's
   * voice only when this language's WORDING marks the speaker's gender, so
   * a politeness variant of an unmarked language is generated once, not
   * once per gender. Null = the canonical row.
   */
  textVariantKey: string | null;
  /**
   * Key of the `audioRecordings` row: `"<male|female>|<formId|auto>"`, the
   * concrete voice the card is spoken in. Null = the canonical audio, which
   * is right only when the wording is canonical AND the canonical voice
   * already is the card's voice.
   */
  audioVariantKey: string | null;
  /** The voice this language's audio is in. */
  voiceGender: 'male' | 'female';
};

/**
 * Whether the settings can apply to this card at all. Cards from before the
 * feature (no stamp) and every user-written sentence keep their canonical
 * rendering for good.
 */
export function cardFollowsPreferences(
  text: Pick<RenderingText, 'userCreated'>,
  card: RenderingCard,
): boolean {
  if (text.userCreated) return false;
  if (card && !card.followsCoursePreferences) return false;
  return true;
}

/** Resolve the card-wide gender axis and voice. */
export function resolveCardRendering(args: {
  text: RenderingText;
  textId: string;
  settings: RenderingSettings;
  card: RenderingCard;
}): CardRendering {
  const canonicalVoiceGender = resolveCardSpeakerGenders(
    args.text,
    args.textId,
  ).audioSpeakerGender;
  const base: CardRendering = {
    gender: AUTO,
    voiceGender: canonicalVoiceGender,
    canonicalVoiceGender,
    needsVoice: false,
  };
  // Note on `text.speakerGender`: on a curriculum text it is the canonical
  // coin flip written back by the sweep (`resolveCardSpeakerGenders`, case
  // 3), never evidence about the sentence, so the setting applies. The one
  // place it IS evidence, a user-written text stamped by the classifier,
  // never reaches this line: such texts have no variants.
  if (!cardFollowsPreferences(args.text, args.card)) return base;
  const forms = args.settings.firstPersonForms;
  if (forms !== 'masculine' && forms !== 'feminine') return base;
  const voiceGender = forms === 'masculine' ? 'male' : 'female';
  return {
    gender: forms,
    voiceGender,
    canonicalVoiceGender,
    needsVoice: voiceGender !== canonicalVoiceGender,
  };
}

/** The legacy fallback the translation worker uses for the addressee gate. */
function addressesSomeone(text: RenderingText): boolean {
  return text.addressesSomeone ?? text.addresseeNumber !== 'not_applicable';
}

/**
 * Pick the politeness form for one language: the single distinct form the
 * selected levels resolve to, or one of several by a per-text hash so a
 * mixed selection alternates evenly and a text keeps its form across
 * regenerations. Salted so it does not correlate with the gender or accent
 * bits of the same id.
 */
export function pickPolitenessForm(
  code: string,
  levels: readonly PolitenessLevel[] | undefined,
  textId: string,
): PolitenessForm | null {
  if (!levels || levels.length === 0) return null;
  const forms = selectedPolitenessForms(code, levels);
  if (forms.length === 0) return null;
  if (forms.length === 1) return forms[0];
  return forms[fnv1a(`${textId}|politeness`) % forms.length];
}

/** The gender part of a variant key. */
export type KeyGender = 'male' | 'female' | typeof AUTO;

export function variantKeyFor(
  gender: KeyGender,
  formId: string | typeof AUTO,
): string | null {
  if (gender === AUTO && formId === AUTO) return null;
  return `${gender}|${formId}`;
}

/** Split a variant key back into its parts. */
export function parseVariantKey(variantKey: string): {
  gender: KeyGender;
  formId: string;
} {
  const [gender, formId] = variantKey.split('|');
  return { gender: gender as KeyGender, formId };
}

/**
 * Resolve what one language of the card reads. `code` is the concrete
 * language of the row (an es_mixed text resolved to es or es_latam, an
 * accent row's language), never a mixed or accent-variant code.
 */
export function resolveLanguageRendering(args: {
  card: CardRendering;
  code: string;
  text: RenderingText;
  textId: string;
  settings: RenderingSettings;
  cardRow: RenderingCard;
}): LanguageRendering {
  const canonical: LanguageRendering = {
    form: null,
    textVariantKey: null,
    audioVariantKey: null,
    voiceGender: args.card.voiceGender,
  };
  if (!cardFollowsPreferences(args.text, args.cardRow)) return canonical;
  const [concrete] = concreteLanguageCodes(args.code);
  let form = pickPolitenessForm(
    concrete,
    args.settings.politenessLevels,
    args.textId,
  );
  // An address language renders a sentence without a "you" the same at
  // every level; the canonical row already is that rendering.
  if (form && !addressesSomeone(args.text) && isAddressLanguage(concrete)) {
    form = null;
  }
  const formId = form ? form.id : AUTO;
  const wordingGender: KeyGender =
    args.card.gender !== AUTO && languageMarksFirstPerson(concrete)
      ? args.card.voiceGender
      : AUTO;
  const textVariantKey = variantKeyFor(wordingGender, formId);
  const audioVariantKey =
    textVariantKey !== null || args.card.needsVoice
      ? variantKeyFor(args.card.voiceGender, formId)
      : null;
  return {
    form,
    textVariantKey,
    audioVariantKey,
    voiceGender: args.card.voiceGender,
  };
}

function isAddressLanguage(code: string): boolean {
  return getPolitenessConfig(code)?.marking === 'address';
}
