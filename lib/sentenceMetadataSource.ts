/**
 * Which classifier build produced a text's linguistic metadata, persisted
 * as `texts.metadataSource`. Same invalidate-by-source contract as
 * `FURIGANA_SOURCES` (convex/lib/textAnnotations.ts): bump the `-v<n>`
 * suffix when the prompt or the model changes in a way that should
 * re-derive existing rows. The content sweep reclassifies curriculum texts
 * whose source is not the current one, lazily, the first time a learner
 * meets them; user-written texts are never reclassified automatically.
 *
 * Dependency-free so lib/voices.ts and lib/preferenceResolution.ts can read
 * it on the client and the server alike; convex/lib/sentenceMetadataShape.ts
 * re-exports it for the Convex side.
 */
export const SENTENCE_METADATA_SOURCES = {
  // v1: gemini-3.1-flash-lite with the first-person-plural rule and the
  // referentGender key (2026-09-07).
  gemini31FlashLite: 'gemini-3.1-flash-lite-v1',
} as const;

export const CURRENT_SENTENCE_METADATA_SOURCE: string =
  SENTENCE_METADATA_SOURCES.gemini31FlashLite;

/**
 * Whether a text's stored metadata is a verdict of the current classifier.
 * The resolver and the sweeps treat `speakerGender` on a curriculum text as
 * evidence only when this holds; otherwise it is the coin flip the sweep
 * wrote back (`resolveCardSpeakerGenders` case 3 in lib/voices.ts).
 */
export function hasCurrentSentenceMetadata(text: {
  metadataSource?: string;
}): boolean {
  return text.metadataSource === CURRENT_SENTENCE_METADATA_SOURCE;
}

/**
 * The speaker gender a text's own content fixes, or null. On a user-written
 * text the classifier's verdict is evidence from the day it landed; on a
 * curriculum text only a verdict of the current classifier counts.
 */
export function definitiveSpeakerGender(text: {
  speakerGender?: string;
  userCreated: boolean;
  metadataSource?: string;
}): 'male' | 'female' | null {
  if (text.speakerGender !== 'male' && text.speakerGender !== 'female') {
    return null;
  }
  if (!text.userCreated && !hasCurrentSentenceMetadata(text)) return null;
  return text.speakerGender;
}

/**
 * Whether the sentence speaks to someone. The explicit classifier boolean,
 * with the legacy fallback for rows from before it carried:
 * `addresseeNumber` is 'not_applicable' exactly when there is no addressee.
 */
export function sentenceAddressesSomeone(text: {
  addressesSomeone?: boolean;
  addresseeNumber?: string;
}): boolean {
  return text.addressesSomeone ?? text.addresseeNumber !== 'not_applicable';
}
