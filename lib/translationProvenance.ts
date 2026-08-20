/**
 * Content provenance: who authored a card, who authored a translation row, and
 * whether an automated pass is allowed to touch either.
 *
 * This module is the SINGLE place that answers those questions. Every sweep,
 * migration, warmup and backfill that regenerates content must route its
 * decision through `mayRegenerateTranslation` rather than re-deriving the rule
 * from `text.userCreated` / `translationSource` inline. That duplication is
 * what let the gender-drift sweep in `scheduleMissingContent` delete
 * chat-authored translations while the version sweep next to it correctly
 * exempted them.
 *
 * Deliberately dependency-free (no Convex, no `lib/languages.ts`) so it can be
 * imported from anywhere. Server mutations, shared libs, client components,
 * without cycles. Callers pass structural shapes, not `Doc<>` types, the same
 * way `SpeakerGenderInput` is declared in `lib/voices.ts`.
 *
 * The `<model>-<reasoning>` tag *format* is not a provenance concern and stays
 * with the model config in `lib/languages.ts` (`getTranslationSource`).
 */

/**
 * Stable identifier for the legacy Google Translate v2 path. Used as the
 * `translationSource` on rows produced by `processTranslationForCard`.
 * The fallback path the LLM queue schedules when every model stage fails.
 */
export const GOOGLE_TRANSLATE_SOURCE = 'google-translate-v2';

/**
 * Stable identifier for translations the user typed manually (no model
 * involved). Used on `createCustomText` insertions when the corresponding
 * entry didn't come from autofill.
 */
export const USER_PROVIDED_TRANSLATION_SOURCE = 'user-provided';

/**
 * Provenance slug for hand-curated translations shipped by a migration
 * (see convex/migrations/updateEssentialGreetings.ts). Like user-provided
 * rows, these were authored by a human and must never be regenerated.
 */
export const CURATED_TRANSLATION_SOURCE = 'curated-manual';

/**
 * Translation provenances that no automated pass may overwrite or delete,
 * *independently of which text they hang off*.
 *
 * Both were written by a person: `user-provided` by the user, `curated-manual`
 * by us. Curated rows in particular live on PREMADE texts, so the
 * `isUserCreatedText` half of the guard below does not cover them. A
 * `translationVersion` bump would silently undo the curation.
 *
 * Prefer `mayRegenerateTranslation`; reach for `isProtectedTranslationSource`
 * directly only where no text doc is in hand (e.g. a `migrateOne` that sees
 * the translation row alone).
 */
export const PROTECTED_TRANSLATION_SOURCES: readonly string[] = [
  USER_PROVIDED_TRANSLATION_SOURCE,
  CURATED_TRANSLATION_SOURCE,
];

export function isProtectedTranslationSource(
  source: string | undefined | null,
): boolean {
  return source != null && PROTECTED_TRANSLATION_SOURCES.includes(source);
}

/** Minimal view of a `texts` row needed to judge who authored it. */
export interface TextProvenance {
  /** false for uploaded dataset rows, true for user-created ones. */
  userCreated: boolean;
}

/** Minimal view of a `translations` row needed to judge who authored it. */
export interface TranslationProvenance {
  /** See `translations.translationSource` in convex/schema.ts. */
  translationSource?: string;
}

/**
 * THE definition of a user-created ("custom") card. Manual entry, bulk
 * import, or chat approval.
 *
 * `texts.userCreated` is the authority: it is required on every row and is set
 * at insert by all three creation paths. `collections.origin` /
 * `cards.collectionOrigin` ('premade' | 'custom' | 'chat') are optional fields
 * that exist for display and the study-content filter. Do NOT use them to
 * decide ownership.
 */
export function isUserCreatedText(text: TextProvenance): boolean {
  return text.userCreated === true;
}

/**
 * The single gate for "may an automated pass delete, overwrite or regenerate
 * this translation row?".
 *
 * False in two cases:
 *   1. The text is user-created. The card is the user's: their wording is the
 *      content, and regenerating it means translating our own stored rendering
 *      back at them, losing whatever vocabulary they were trying to learn.
 *      This holds regardless of how the row was produced: a chat- or
 *      autofill-generated translation on a user's card is still part of the
 *      card they chose to keep.
 *   2. The row itself is human-authored (`user-provided` / `curated-manual`),
 *      which also protects hand-curated rows sitting on premade texts.
 *
 * Note this governs the TEXT only. Audio may still be regenerated for a
 * user-created card. See the voice-gender validity loop in
 * `scheduleMissingContent`, which is deliberately left ungated so a card whose
 * resolved speaker gender changes still gets a matching voice.
 */
export function mayRegenerateTranslation(
  text: TextProvenance,
  translation: TranslationProvenance,
): boolean {
  if (isUserCreatedText(text)) return false;
  return !isProtectedTranslationSource(translation.translationSource);
}
