/**
 * Speaker-gender preference — the user-level "phrase and voice sentences for
 * my gender" feature.
 *
 * The stored setting lives on `userSettings.speakerGenderPreference`
 * ('male' | 'female' | 'mixed', absent = 'mixed'). 'mixed' is the no-op
 * value: it keeps exactly what the dataset does today (a deterministic
 * per-text coin flip, see `resolveCardSpeakerGenders` in lib/voices.ts), so
 * defaulting new and existing users to 'mixed' changes nothing.
 *
 * How the preference is applied:
 *  - PREMADE texts are shared across users, so their rows are never patched
 *    per user. The preference is an overlay at read/generation time: audio is
 *    resolved from the content-addressed `audioAssets` store at the preferred
 *    voice gender, and — only for languages whose `speakerGenderMarking` is
 *    not 'none' and sentences that can actually change (see
 *    `textEligibleForGenderVariant`) — a gendered translation variant row
 *    (`translationVariants` table) replaces the base translation.
 *  - USER-CREATED texts (custom + chat) belong to one user, so the
 *    preference applies at creation instead: it replaces the coin flip
 *    wherever the sentence itself doesn't force a gender. A definitive
 *    LLM metadata verdict (the uploaded sentence is inherently gendered,
 *    e.g. "Estoy cansada") always wins over the preference, which is what
 *    keeps a female-spoken upload voiced female. Existing user-created cards
 *    keep the gender they were created under.
 *
 * KILL-SWITCH (deliberately not implemented yet): every consumer resolves
 * the stored value through `resolveSpeakerGenderPreference` below — server
 * queries/mutations, the variant scheduler, chat prompt assembly, and the
 * settings UI visibility all branch on its result. Disabling the feature
 * globally is therefore a one-line change HERE (return 'mixed'
 * unconditionally, plus a flag export the settings UI reads to hide the
 * control): everyone — existing and new users — instantly reverts to the
 * mixed behavior with no migration, because 'mixed' is the no-op path
 * everywhere and variant rows/assets are inert cache when unread.
 */

import { getLanguageByCode } from './languages';

export const SPEAKER_GENDER_PREFERENCES = ['male', 'female', 'mixed'] as const;
export type SpeakerGenderPreference = (typeof SPEAKER_GENDER_PREFERENCES)[number];

/**
 * Resolve the raw stored setting to an effective preference. The single
 * choke point every consumer must go through (see the kill-switch note in
 * the module header). Unknown/absent values resolve to 'mixed'.
 */
export function resolveSpeakerGenderPreference(
  stored: string | null | undefined,
): SpeakerGenderPreference {
  return stored === 'male' || stored === 'female' ? stored : 'mixed';
}

/**
 * The concrete voice/speaker gender a preference asks for, or null for
 * 'mixed' (= keep the per-text stored gender; the caller applies no overlay
 * and falls through to today's behavior).
 */
export function preferenceGender(
  preference: SpeakerGenderPreference,
): 'male' | 'female' | null {
  return preference === 'mixed' ? null : preference;
}

/**
 * First-person reference in an ENGLISH source sentence. Premade dataset
 * texts are always English, so this is the language-independent prefilter
 * for "can the speaker's gender change this sentence at all". Object forms
 * (me/us) over-trigger slightly — harmless: an unnecessary variant
 * generation runs the same deterministic prompt and lands the same text,
 * once, and is never re-attempted.
 */
const FIRST_PERSON_RE =
  /\b(?:i|i'(?:m|d|ll|ve)|me|my|mine|myself|we|we'(?:re|d|ll|ve)|us|our|ours|ourselves)\b/i;

/** Exported for tests only. */
export function sourceTextHasFirstPerson(sourceText: string): boolean {
  return FIRST_PERSON_RE.test(sourceText);
}

/**
 * Whether a premade sentence can produce a DIFFERENT translation in
 * `language` when the speaker's gender changes — the "only for sentences and
 * languages where it actually matters" gate for gendered translation
 * variants.
 *
 * - Language gate: `speakerGenderMarking !== 'none'` (lib/languages.ts).
 * - Sentence gate: the English source contains a first-person reference,
 *   except for `speakerGenderPervasive` languages (Thai), where gendered
 *   polite particles attach to nearly every sentence.
 *
 * Audio voice gender is deliberately NOT gated by this: a preference always
 * applies to the voice, in every language.
 */
export function textEligibleForGenderVariant(
  language: string,
  sourceText: string,
): boolean {
  const lang = getLanguageByCode(language);
  if (!lang || lang.speakerGenderMarking === 'none') return false;
  if (lang.speakerGenderPervasive) return true;
  return sourceTextHasFirstPerson(sourceText);
}
