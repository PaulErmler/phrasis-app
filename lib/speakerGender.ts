/**
 * Per-user speaker-gender resolution layer.
 *
 * Texts, translations, and audio are GLOBAL rows shared by every user, so a
 * user's gender preference must never be written into them. Instead the
 * shared content layer is variant-additive (one translations row per gender
 * slot, gender-keyed audio assets) and every consumer resolves an
 * "effective" speaker gender per (text, user) at read/schedule time via the
 * pure helpers in this file.
 *
 * Layering:
 *  - `lib/voices.ts` owns the CANONICAL layer (what exists today): the
 *    per-text mixed-mode assignment written by `resolveCardSpeakerGenders`
 *    (definitive metadata mirrored, otherwise a deterministic seeded flip).
 *  - This file layers the per-course preference on top. With no preference,
 *    preference 'mixed', or the kill switch off, resolution is bit-identical
 *    to the canonical layer.
 *
 * Two axes fall out of one effective gender:
 *  - VOICE gender applies to every language (any sentence can be spoken by a
 *    male or female voice).
 *  - TRANSLATION variants exist only for languages whose config says the
 *    text itself changes with the speaker (`speakerGenderMarking` in
 *    lib/languages.ts); everywhere else the single rendering occupies the
 *    'neutral' slot.
 */

import { languageMarksSpeakerGender } from './languages';
import { resolveAudioSpeakerGender } from './voices';

/**
 * Kill switch for the whole speaker-gender-preference feature (no remote
 * flag system exists; flip + deploy, matching the version-stamp pattern).
 * Off ⇒ the settings section and chat prompt section disappear and
 * `resolveEffectiveSpeakerGender` returns the canonical assignment for
 * everyone (= today's behavior). Stored preferences and generated variant
 * rows/assets are retained untouched, so re-enabling is lossless.
 */
export const SPEAKER_GENDER_FEATURE_ENABLED = true;

/**
 * The per-course setting. 'mixed' (and unset) = today's behavior: a
 * deterministic ~50/50 per-text assignment. Stored as an explicit literal in
 * `courseSettings.speakerGenderPreference` because `updateCourseSettings`
 * skips undefined args — switching BACK to mixed must be a storable value.
 */
export const SPEAKER_GENDER_PREFERENCE_VALUES = [
  'male',
  'female',
  'mixed',
] as const;
export type SpeakerGenderPreference =
  (typeof SPEAKER_GENDER_PREFERENCE_VALUES)[number];

/** A concrete voice/rendering gender (what audio and gendered text use). */
export type EffectiveSpeakerGender = 'male' | 'female';

/**
 * The slot a translations row occupies (`translations.speakerGender`):
 *  - 'male' / 'female': rendering produced for that speaker gender (only
 *    ever written for marked languages).
 *  - 'neutral': rendering valid for BOTH genders — always the slot for
 *    unmarked languages, and the collapsed slot for marked-language
 *    sentences proven gender-invariant.
 * `undefined` on a stored row means only "legacy row written before this
 * feature" (read-tolerated, never written going forward).
 */
export type TranslationGenderSlot = 'male' | 'female' | 'neutral';

/** The `texts` fields the effective-gender resolution reads. */
export interface EffectiveGenderInput {
  /** Linguistic verdict: 'male' | 'female' | 'neutral' | undefined. */
  speakerGender?: string;
  /** Canonical mixed-mode voice assignment: 'male' | 'female' | undefined. */
  audioSpeakerGender?: string;
  /**
   * `texts.userCreated`. Load-bearing for the pin rule: on USER-CREATED
   * texts a male/female `speakerGender` is a real morphology verdict from
   * the metadata LLM (upload pinning). On PREMADE texts the same field is
   * just the mirrored canonical coin-flip (`resolveCardSpeakerGenders` case
   * 3 writes BOTH fields), so treating it as definitive would pin the whole
   * dataset to its coin-flip and neuter the preference.
   */
  userCreated: boolean;
}

/**
 * Resolve the speaker gender a given user experiences for a text.
 *
 * Precedence:
 *  1. Definitive linguistic gender on a USER-CREATED text wins — this is
 *     what pins uploads and inherently gendered user content ("Estoy
 *     cansada") regardless of the preference. Premade texts never pin: any
 *     male/female `speakerGender` they carry is the mirrored canonical flip
 *     (see EffectiveGenderInput.userCreated), and inherently-gendered
 *     wording ("I am his wife") is preserved by the translation itself, not
 *     by the tag.
 *  2. A male/female preference (feature on).
 *  3. Canonical default: the stored mixed-mode assignment, else the same
 *     deterministic seeded flip `resolveCardSpeakerGenders` uses. Identical
 *     to today's behavior; also the path when the kill switch is off.
 *
 * `seed` must be the text's `_id` so concurrent callers agree (see the
 * determinism warning on `resolveAudioSpeakerGender`).
 */
export function resolveEffectiveSpeakerGender(
  text: EffectiveGenderInput,
  seed: string,
  preference: SpeakerGenderPreference | undefined,
): EffectiveSpeakerGender {
  if (
    text.userCreated &&
    (text.speakerGender === 'male' || text.speakerGender === 'female')
  ) {
    return text.speakerGender;
  }
  if (
    SPEAKER_GENDER_FEATURE_ENABLED &&
    (preference === 'male' || preference === 'female')
  ) {
    return preference;
  }
  if (text.speakerGender === 'male' || text.speakerGender === 'female') {
    return text.speakerGender;
  }
  if (
    text.audioSpeakerGender === 'male' ||
    text.audioSpeakerGender === 'female'
  ) {
    return text.audioSpeakerGender;
  }
  return resolveAudioSpeakerGender(text.speakerGender, seed);
}

/**
 * Whether the speaker-gender setting exists for a course at all: some course
 * language (base or target) must mark speaker gender, and the feature must
 * be on. Gates the settings section, the onboarding step (future), and the
 * chat prompt section.
 */
export function courseMarksSpeakerGender(
  baseLanguages: readonly string[],
  targetLanguages: readonly string[],
): boolean {
  if (!SPEAKER_GENDER_FEATURE_ENABLED) return false;
  return (
    baseLanguages.some(languageMarksSpeakerGender) ||
    targetLanguages.some(languageMarksSpeakerGender)
  );
}

/**
 * The slot a write for (language, effective gender) occupies. Never
 * undefined: marked languages store the concrete gender, unmarked languages
 * store 'neutral' (their single rendering serves both genders).
 */
export function translationGenderSlot(
  targetLanguage: string,
  effectiveGender: EffectiveSpeakerGender,
): TranslationGenderSlot {
  return languageMarksSpeakerGender(targetLanguage)
    ? effectiveGender
    : 'neutral';
}

/** Result of picking a translation variant out of a text+language's rows. */
export interface TranslationVariantPick<T> {
  /** Best row to DISPLAY right now (never blank while a variant generates). */
  row: T | null;
  /**
   * Whether `row` genuinely serves the effective gender — false means the
   * ensure pass should generate the missing variant (display falls back to
   * whatever exists in the meantime).
   */
  satisfied: boolean;
}

/**
 * Tolerant multi-row variant pick over all rows of one (textId, language).
 *
 * Unmarked language: stamps are meaningless (legacy male/female stamps are
 * retired by the stampNeutralOnUnmarkedTranslations migration) — any row
 * serves both genders. Preference order 'neutral' → legacy-unstamped → any
 * keeps the pick deterministic pre-migration.
 *
 * Marked language:
 *   1. exact stamp match → satisfied
 *   2. 'neutral' stamp (collapse proved the sentence gender-invariant) →
 *      satisfied
 *   3. legacy unstamped row: the canonical carrier — it was generated under
 *      the canonical gender, so it satisfies only that gender; it is still
 *      the row to display while the other variant generates
 *   4. any other row (opposite gender): display fallback, not satisfied
 *
 * Pass rows in index order (`.take(n)` result) for a deterministic pick.
 */
export function pickTranslationVariant<T extends { speakerGender?: string }>(
  rows: readonly T[],
  targetLanguage: string,
  effectiveGender: EffectiveSpeakerGender,
  canonicalGender: EffectiveSpeakerGender,
): TranslationVariantPick<T> {
  if (rows.length === 0) return { row: null, satisfied: false };

  if (!languageMarksSpeakerGender(targetLanguage)) {
    const row =
      rows.find((r) => r.speakerGender === 'neutral') ??
      rows.find((r) => r.speakerGender === undefined) ??
      rows[0];
    return { row, satisfied: true };
  }

  const exact = rows.find((r) => r.speakerGender === effectiveGender);
  if (exact) return { row: exact, satisfied: true };

  const neutral = rows.find((r) => r.speakerGender === 'neutral');
  if (neutral) return { row: neutral, satisfied: true };

  const legacy = rows.find((r) => r.speakerGender === undefined);
  if (legacy) {
    return { row: legacy, satisfied: effectiveGender === canonicalGender };
  }

  return { row: rows[0], satisfied: false };
}

/**
 * Preference-INDEPENDENT pick: the row the canonical (mixed-mode) gender
 * serves. For read sites that must not vary with any user's preference —
 * card searchable text, placement-test serving, the chat card-context block.
 */
export function pickCanonicalTranslationRow<
  T extends { speakerGender?: string },
>(
  rows: readonly T[],
  targetLanguage: string,
  canonicalGender: EffectiveSpeakerGender,
): T | null {
  return pickTranslationVariant(rows, targetLanguage, canonicalGender, canonicalGender).row;
}
