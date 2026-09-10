/**
 * Which rendering of a sentence a card is served, given the course's
 * politeness setting and the card's own corrections. Pure and
 * dependency-light so the client (settings previews), the Convex readers
 * (convex/db/translationReads.ts) and the generation path (convex/lib/
 * contentScheduling.ts) all agree on one answer.
 *
 * Layers: `texts` is the identity of a meaning and carries the content
 * semantics (a definitive speaker gender, the register metadata, the
 * voice); the course settings are the preference; this module is the one
 * resolver; the `translations` / `audioRecordings` rows keyed by
 * `variantKey` are the realizations. The resolver never writes anything.
 *
 * Every card resolves to one RENDERING KEY per language,
 * `"<male|female>|<formId|none>"` (`renderingKey`), on the text row and on
 * the audio pointer alike. The voice is always decided: the text's own
 * (`texts.audioSpeakerGender`, the classifier's verdict where the sentence
 * fixes it, else one seeded flip), or the Flag dialog's correction. The
 * form is the card's override, else the course's pick, else the sentence's
 * PRIMARY form (lib/languageForms.ts `primaryPolitenessForm`), and `none`
 * when nothing in the sentence carries a form in that language. Rows with
 * no key are legacy rows from before the cutover; a card that does not
 * follow the settings (`acceptsLegacyRow`) is served them.
 */

import { seededIndex } from './languages';
import {
  concreteLanguageCodes,
  formAxisApplies,
  NO_FORM,
  primaryPolitenessForm,
  selectedPolitenessForms,
  type PolitenessForm,
  type PolitenessLevel,
} from './languageForms';
import { resolveCardSpeakerGenders } from './voices';
import { definitiveSpeakerGender } from './sentenceMetadataSource';

export { NO_FORM };

/** The course-settings fields this module reads. Undefined = no preference. */
export type RenderingSettings = {
  politenessLevels?: PolitenessLevel[];
};

/** The `texts` fields this module reads. */
export type RenderingText = {
  speakerGender?: string;
  audioSpeakerGender?: string;
  register?: string;
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

export type VoiceGender = 'male' | 'female';

/** Whether a card carries a per-card correction the sweep must render. */
export function hasRenderingOverride(card: RenderingCard): boolean {
  return (
    card?.renderingGenderOverride !== undefined ||
    card?.renderingPolitenessOverride !== undefined
  );
}

/** The voice a gender axis is spoken in. */
export function voiceOf(axis: 'masculine' | 'feminine'): VoiceGender {
  return axis === 'masculine' ? 'male' : 'female';
}

/** The gender axis a voice renders. */
export function axisOf(voice: VoiceGender): 'masculine' | 'feminine' {
  return voice === 'male' ? 'masculine' : 'feminine';
}

/** Build a rendering key. */
export function renderingKey(voice: VoiceGender, formId: string): string {
  return `${voice}|${formId}`;
}

/** Split a rendering key back into its parts. */
export function parseRenderingKey(key: string): {
  voice: VoiceGender;
  formId: string;
} {
  const [voice, formId] = key.split('|');
  return { voice: voice as VoiceGender, formId: formId ?? NO_FORM };
}

export type CardRendering = {
  /** The voice every language of the card is spoken in and written for. */
  voiceGender: VoiceGender;
  /** The text's own voice; equals `voiceGender` unless the card is corrected. */
  textVoiceGender: VoiceGender;
  /**
   * Whether an unkeyed (legacy) row is THE rendering for this card: every
   * card on a user-written text, and a card from before the feature that
   * carries no Flag-dialog correction. Such a card keeps its legacy rows
   * for good and reads a keyed row only for a language it has no legacy
   * row in. A settings-following card, a corrected card and a reader with
   * no card read the keyed row and are served a legacy row only as a
   * placeholder while the keyed one is made.
   */
  acceptsLegacyRow: boolean;
};

export type LanguageRendering = {
  /** The politeness form for this language, or null when the key's form is `none`. */
  form: PolitenessForm | null;
  /** The form part of the key: a form id or `none`. */
  formId: string;
  /** The rendering key on `translations` and `audioRecordings`. */
  key: string;
  /** The voice this language's audio is in. */
  voiceGender: VoiceGender;
};

/**
 * Whether the settings can apply to this card at all. Cards from before the
 * feature (no stamp) and every user-written sentence keep their rendering
 * for good.
 */
export function cardFollowsPreferences(
  text: Pick<RenderingText, 'userCreated'>,
  card: RenderingCard,
): boolean {
  if (text.userCreated) return false;
  if (card && !card.followsCoursePreferences) return false;
  return true;
}

/** See `CardRendering.acceptsLegacyRow`. */
export function cardAcceptsLegacyRow(
  text: Pick<RenderingText, 'userCreated'>,
  card: RenderingCard,
): boolean {
  if (text.userCreated) return true;
  if (card === null) return false;
  return !card.followsCoursePreferences && !hasRenderingOverride(card);
}

/**
 * Resolve the card-wide voice. The text's own voice is the answer for every
 * card except one carrying a Flag-dialog correction on a sentence that does
 * not fix its own gender.
 */
export function resolveCardRendering(args: {
  text: RenderingText;
  textId: string;
  card: RenderingCard;
}): CardRendering {
  const textVoiceGender = resolveCardSpeakerGenders(
    args.text,
    args.textId,
  ).audioSpeakerGender;
  const acceptsLegacyRow = cardAcceptsLegacyRow(args.text, args.card);
  const base: CardRendering = {
    voiceGender: textVoiceGender,
    textVoiceGender,
    acceptsLegacyRow,
  };
  if (args.text.userCreated) return base;
  // Precedence: the sentence's own content, then the card's correction.
  // `text.speakerGender` on a curriculum text from before the cutover may be
  // the coin flip the old sweep wrote back; it is evidence only at the
  // current classifier source (lib/sentenceMetadataSource.ts).
  if (definitiveSpeakerGender(args.text) !== null) return base;
  const override = args.card?.renderingGenderOverride;
  if (override === undefined) return base;
  return { ...base, voiceGender: override };
}

/**
 * Pick the politeness form for one language from a level set: the single
 * distinct form the selected levels resolve to, or one of several by a
 * per-text hash so a mixed selection alternates evenly and a text keeps its
 * form across regenerations.
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
  const [concrete] = concreteLanguageCodes(args.code);
  const voice = args.card.voiceGender;
  const form = args.text.userCreated
    ? null
    : resolvePolitenessForm(concrete, args);
  const formId = form ? form.id : NO_FORM;
  return {
    form,
    formId,
    key: renderingKey(voice, formId),
    voiceGender: voice,
  };
}

function resolvePolitenessForm(
  concrete: string,
  args: {
    text: RenderingText;
    textId: string;
    settings: RenderingSettings;
    cardRow: RenderingCard;
  },
): PolitenessForm | null {
  // The card's own correction outranks the setting and ignores the
  // addressee gate: `addressesSomeone` is the classifier's verdict, and a
  // learner ticking "the politeness level is wrong" on a sentence it marked
  // as addressing nobody is correcting exactly that verdict.
  const override = args.cardRow?.renderingPolitenessOverride;
  if (override) return pickPolitenessForm(concrete, [override], args.textId);
  if (cardFollowsPreferences(args.text, args.cardRow)) {
    const picked = pickPolitenessForm(
      concrete,
      args.settings.politenessLevels,
      args.textId,
    );
    if (picked) {
      return formAxisApplies(concrete, args.text) ? picked : null;
    }
  }
  return primaryPolitenessForm(concrete, args.text);
}

/**
 * What the text's OWN language reads. The source wording is the text and
 * is never rewritten, so no form; only the voice matters, and the clip is
 * keyed like every other language of the card.
 */
export function resolveSourceRendering(card: CardRendering): LanguageRendering {
  return {
    form: null,
    formId: NO_FORM,
    key: renderingKey(card.voiceGender, NO_FORM),
    voiceGender: card.voiceGender,
  };
}

/**
 * The primary key of a (text, language): the text's own voice and the
 * sentence's primary form. What a card with no override and no setting
 * reads, and the row every other key is versioned from.
 */
export function primaryRenderingKey(args: {
  text: RenderingText;
  textId: string;
  code: string;
}): string {
  const voice = resolveCardSpeakerGenders(
    args.text,
    args.textId,
  ).audioSpeakerGender;
  const [concrete] = concreteLanguageCodes(args.code);
  const form = args.text.userCreated
    ? null
    : primaryPolitenessForm(concrete, args.text);
  return renderingKey(voice, form ? form.id : NO_FORM);
}
