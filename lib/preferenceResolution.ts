/**
 * Which rendering of a sentence a card is served, given the course's
 * politeness setting and the card's own corrections. Pure and
 * dependency-light so the client (settings previews), the Convex readers
 * (convex/db/translationReads.ts) and the generation path (convex/lib/
 * contentScheduling.ts) all agree on one answer.
 *
 * Layers: `texts` is the identity of a meaning and carries the content
 * semantics (a definitive speaker gender, the register metadata); the
 * course settings are the preference; this module is the one resolver;
 * the `translations` / `audioRecordings` rows keyed by `variantKey` are the
 * disposable realizations. The resolver never writes anything.
 *
 * Gender is resolved ONCE per card and is the same for every language of
 * the card: the text's own voice (its classifier verdict or its coin flip)
 * sets the wording and the voice everywhere, marked or not. There is no
 * course-level gender choice: the curriculum is rendered in one gender per
 * sentence (`courseSettings.firstPersonForms` is stored but not read), and
 * the only way a card leaves that gender is the Flag dialog's per-card
 * correction. Politeness is resolved per language, because each language
 * maps the global levels onto its own forms.
 */

import { seededIndex } from './languages';
import {
  concreteLanguageCodes,
  getPolitenessConfig,
  languageMarksFirstPerson,
  selectedPolitenessForms,
  type PolitenessForm,
  type PolitenessLevel,
} from './languageForms';
import { resolveCardSpeakerGenders } from './voices';
import { definitiveSpeakerGender } from './sentenceMetadataSource';

/** The course-settings fields this module reads. Undefined = canonical. */
export type RenderingSettings = {
  politenessLevels?: PolitenessLevel[];
};

/** The `texts` fields this module reads. */
export type RenderingText = {
  speakerGender?: string;
  audioSpeakerGender?: string;
  addressesSomeone?: boolean;
  addresseeNumber?: string;
  userCreated: boolean;
  /** See `texts.metadataSource`: when current, `speakerGender` is evidence. */
  metadataSource?: string;
};

/**
 * The `cards` fields this module reads. `null` is a reader with no card
 * (collection preview, placement test): it sees what a card created now
 * would get. The two overrides are the Flag dialog's per-card corrections
 * (schema.ts); they outrank the settings and apply to any curriculum card.
 */
export type RenderingCard = {
  followsCoursePreferences?: true;
  renderingGenderOverride?: 'male' | 'female';
  renderingPolitenessOverride?: PolitenessLevel;
} | null;

/** Whether a card carries a per-card correction the sweep must render. */
export function hasRenderingOverride(card: RenderingCard): boolean {
  return (
    card?.renderingGenderOverride !== undefined ||
    card?.renderingPolitenessOverride !== undefined
  );
}

/** The gender axis of a variant key. 'auto' = as the canonical rendering. */
export type GenderAxis = 'masculine' | 'feminine' | 'auto';

export const AUTO = 'auto';

/** The voice a gender axis is spoken in. */
export function voiceOf(axis: 'masculine' | 'feminine'): 'male' | 'female' {
  return axis === 'masculine' ? 'male' : 'female';
}

/** The gender axis a voice renders. */
export function axisOf(voice: 'male' | 'female'): 'masculine' | 'feminine' {
  return voice === 'male' ? 'masculine' : 'feminine';
}

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

/**
 * Resolve the card-wide gender axis and voice. The canonical rendering is
 * the answer for every card except one carrying a Flag-dialog correction:
 * the text's own voice is the gender its wording was generated in, so the
 * card shows and hears one gender without any variant.
 */
export function resolveCardRendering(args: {
  text: RenderingText;
  textId: string;
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
  if (args.text.userCreated) return base;
  // Precedence: the sentence's own content, then the card's correction.
  // `text.speakerGender` on a curriculum text is the coin flip the sweep
  // wrote back (`resolveCardSpeakerGenders`, case 3) unless the row carries
  // the current classifier's stamp (lib/sentenceMetadataSource.ts); only
  // then is it evidence, and "We are brothers" is served in its own voice
  // whatever the card says. `canonicalVoiceGender` already is that voice:
  // case 1 mirrors it.
  if (definitiveSpeakerGender(args.text) !== null) return base;
  const voiceGender = args.card?.renderingGenderOverride;
  if (voiceGender === undefined) return base;
  return {
    gender: axisOf(voiceGender),
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
 * regenerations.
 *
 * `seededIndex`, never `fnv1a(...) % n`: a raw FNV-1a modulo 2 is the seed's
 * character parity and nothing else, so it agrees with EVERY other `% 2` pick
 * on the same textId no matter how each is salted. That is what tied the form
 * to the speaker's gender until 2026-09-08 (`du` on every male-voiced card,
 * `Sie` on every female-voiced one, never mixed).
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
  return forms[seededIndex(`${textId}|politeness`, forms.length)];
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
  if (args.text.userCreated) return canonical;
  const [concrete] = concreteLanguageCodes(args.code);
  // The card's own correction outranks the setting and needs no stamp; the
  // setting applies only to a card that follows it. The gender axis arrived
  // resolved in `args.card` under the same precedence.
  const override = args.cardRow?.renderingPolitenessOverride;
  let form = override
    ? pickPolitenessForm(concrete, [override], args.textId)
    : cardFollowsPreferences(args.text, args.cardRow)
      ? pickPolitenessForm(
          concrete,
          args.settings.politenessLevels,
          args.textId,
        )
      : null;
  // An address language renders a sentence without a "you" the same at
  // every level; the canonical row already is that rendering. Never for an
  // override: `addressesSomeone` is the classifier's verdict, and a learner
  // ticking "the politeness level is wrong" on a sentence it marked as
  // addressing nobody is correcting exactly that verdict. A correction on a
  // true no-addressee sentence buys one rewrite that comes back identical
  // and is stored `sameAsCanonical`.
  if (
    form &&
    !override &&
    !addressesSomeone(args.text) &&
    isAddressLanguage(concrete)
  ) {
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

/**
 * What the text's OWN language reads. The source wording is the text and
 * is never rewritten, so no form and no text key; only the voice can
 * differ, and it does exactly when the card needs a voice the canonical
 * clip is not in. The same rule an unmarked target follows.
 */
export function resolveSourceRendering(card: CardRendering): LanguageRendering {
  return {
    form: null,
    textVariantKey: null,
    audioVariantKey: card.needsVoice
      ? variantKeyFor(card.voiceGender, AUTO)
      : null,
    voiceGender: card.voiceGender,
  };
}

function isAddressLanguage(code: string): boolean {
  return getPolitenessConfig(code)?.marking === 'address';
}
