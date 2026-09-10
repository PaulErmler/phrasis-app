/**
 * The RENDERING KEY: which voice a sentence's translation and audio were
 * written for. Pure and dependency-light so the client (chips), the Convex
 * readers (convex/db/translationReads.ts) and the generation path
 * (convex/lib/contentScheduling.ts) all agree on one answer. The resolver
 * never writes anything.
 *
 * A sentence has ONE live translation per language and one clip per
 * language, stamped with the voice they were made for
 * (`translations.variantKey`, `audioRecordings.variantKey`). The voice is
 * the text's own: the classifier's verdict where the sentence fixes it,
 * else one seeded flip (`resolveCardSpeakerGenders` in lib/voices.ts).
 * Nothing asks a text for a voice other than its own, so a voice change
 * re-keys the row it has rather than adding a second one.
 */

import { resolveCardSpeakerGenders, type SpeakerGenderInput } from './voices';

export type VoiceGender = 'male' | 'female';

/** The `texts` fields this module reads. */
export type RenderingText = SpeakerGenderInput;

/** The voice a gender axis is spoken in. */
export function voiceOf(axis: 'masculine' | 'feminine'): VoiceGender {
  return axis === 'masculine' ? 'male' : 'female';
}

/** The gender axis a voice renders. */
export function axisOf(voice: VoiceGender): 'masculine' | 'feminine' {
  return voice === 'male' ? 'masculine' : 'feminine';
}

/**
 * Build a rendering key. One axis today, so the key IS the voice; the
 * function stays because every writer and the verifier speak in keys, and a
 * second axis would land here.
 */
export function renderingKey(voice: VoiceGender): string {
  return voice;
}

/** Split a rendering key back into its parts. */
export function parseRenderingKey(key: string): { voice: VoiceGender } {
  return { voice: key === 'female' ? 'female' : 'male' };
}

export type CardRendering = {
  /** The voice every language of the card is spoken in and written for. */
  voiceGender: VoiceGender;
};

/**
 * The voice a text renders in. Cards never diverge from it: the card
 * argument is gone with the per-card override, so every reader of a text
 * gets the same answer.
 */
export function resolveCardRendering(args: {
  text: RenderingText;
  textId: string;
}): CardRendering {
  return {
    voiceGender: resolveCardSpeakerGenders(args.text, args.textId)
      .audioSpeakerGender,
  };
}

/** The key of a (text, language): the text's voice. */
export function textRenderingKey(args: {
  text: RenderingText;
  textId: string;
}): string {
  return renderingKey(resolveCardRendering(args).voiceGender);
}
