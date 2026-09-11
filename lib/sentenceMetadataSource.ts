/**
 * Which build of the full classifier produced a user-written text's
 * linguistic metadata, persisted as `texts.metadataSource`. Bump the `-v<n>`
 * suffix when the prompt or the model changes in a way that should be
 * told apart in the data. Nothing reclassifies automatically: user-written
 * texts are classified once at creation, curriculum texts carry the
 * offline scan's verdict (lib/speakerGenderPrompt.ts) from the dataset
 * upload.
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
 * The speaker gender a text's own content fixes, or null. On a user-written
 * text the classifier's verdict is evidence from the day it landed. On a
 * curriculum text a male/female `speakerGender` counts only when some
 * classifier stamped it (`metadataSource`: the offline corpus scan through
 * the dataset upload, the in-app speaker check, or the full classifier);
 * unstamped, it is the coin flip the pre-2026-09-10 sweep wrote back, and
 * the voice stays whatever `audioSpeakerGender` holds.
 */
export function definitiveSpeakerGender(text: {
  speakerGender?: string;
  userCreated: boolean;
  metadataSource?: string;
}): 'male' | 'female' | null {
  if (text.speakerGender !== 'male' && text.speakerGender !== 'female') {
    return null;
  }
  if (!text.userCreated && text.metadataSource === undefined) return null;
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
