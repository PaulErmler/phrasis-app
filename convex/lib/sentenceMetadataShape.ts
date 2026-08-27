/**
 * Sentence-metadata value sets, the `Metadata` type, and the strict
 * validator. Split out of features/sentenceMetadata.ts so modules that must
 * stay free of the Convex runtime at import time (convex/lib/
 * translationAutofillPrompt.ts and, through it, scripts/
 * eval-translation-autofill.ts) can validate an LLM reply through the exact
 * production code path. features/sentenceMetadata.ts re-exports everything
 * here, so its existing importers keep one import site.
 */

export const ALLOWED_REGISTER = ['formal', 'informal', 'neutral'] as const;
export const ALLOWED_ADDRESSEE_NUMBER = [
  'singular',
  'plural',
  'not_applicable',
] as const;
export const ALLOWED_SPEAKER_GENDER = ['male', 'female', 'neutral'] as const;
export const ALLOWED_ADDRESSEE_GENDER = [
  'male',
  'female',
  'neutral',
  'not_applicable',
] as const;

export type Metadata = {
  register: (typeof ALLOWED_REGISTER)[number];
  addresseeNumber: (typeof ALLOWED_ADDRESSEE_NUMBER)[number];
  speakerGender: (typeof ALLOWED_SPEAKER_GENDER)[number];
  addresseeGender: (typeof ALLOWED_ADDRESSEE_GENDER)[number];
  addressesSomeone: boolean;
};

function validateField<T extends string>(
  input: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`Metadata field ${field} is missing or not a string`);
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${field} value: ${JSON.stringify(value)}`);
  }
  return value as T;
}

/**
 * Validate that an arbitrary value is a well-formed sentence-metadata object.
 * Throws plain `Error` (not `ConvexError`) so callers can re-wrap as they see fit.
 * Used both server-side after auto-fill and inside the metadata-fetch action.
 */
export function validateSentenceMetadata(input: unknown): Metadata {
  if (input === null || typeof input !== 'object') {
    throw new Error('Metadata response is not an object');
  }
  const obj = input as Record<string, unknown>;
  const addressesSomeone = obj.addressesSomeone;
  if (typeof addressesSomeone !== 'boolean') {
    throw new Error(
      `Metadata field addressesSomeone is missing or not a boolean: ${JSON.stringify(addressesSomeone)}`,
    );
  }
  return {
    register: validateField(obj, 'register', ALLOWED_REGISTER),
    addresseeNumber: validateField(
      obj,
      'addresseeNumber',
      ALLOWED_ADDRESSEE_NUMBER,
    ),
    speakerGender: validateField(obj, 'speakerGender', ALLOWED_SPEAKER_GENDER),
    addresseeGender: validateField(
      obj,
      'addresseeGender',
      ALLOWED_ADDRESSEE_GENDER,
    ),
    addressesSomeone,
  };
}
