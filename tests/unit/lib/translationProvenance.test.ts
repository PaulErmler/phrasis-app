import { describe, it, expect } from 'vitest';
import {
  CURATED_TRANSLATION_SOURCE,
  GOOGLE_TRANSLATE_SOURCE,
  isProtectedTranslationSource,
  isUserCreatedText,
  mayRegenerateTranslation,
  USER_PROVIDED_TRANSLATION_SOURCE,
} from '@/lib/translationProvenance';

const premade = { userCreated: false };
const userOwned = { userCreated: true };

describe('isUserCreatedText', () => {
  it('is true only for userCreated rows', () => {
    expect(isUserCreatedText(userOwned)).toBe(true);
    expect(isUserCreatedText(premade)).toBe(false);
  });
});

describe('isProtectedTranslationSource', () => {
  it('protects the two human-authored provenances', () => {
    expect(isProtectedTranslationSource(USER_PROVIDED_TRANSLATION_SOURCE)).toBe(true);
    expect(isProtectedTranslationSource(CURATED_TRANSLATION_SOURCE)).toBe(true);
  });

  it('does not protect machine output or an untagged row', () => {
    expect(isProtectedTranslationSource(GOOGLE_TRANSLATE_SOURCE)).toBe(false);
    expect(isProtectedTranslationSource('google/gemini-3.1-flash-lite-high')).toBe(false);
    expect(isProtectedTranslationSource(undefined)).toBe(false);
    expect(isProtectedTranslationSource(null)).toBe(false);
  });
});

describe('mayRegenerateTranslation', () => {
  it('allows regenerating machine output on premade texts', () => {
    expect(
      mayRegenerateTranslation(premade, {
        translationSource: 'google/gemini-3.1-flash-lite-high',
      }),
    ).toBe(true);
    expect(
      mayRegenerateTranslation(premade, { translationSource: GOOGLE_TRANSLATE_SOURCE }),
    ).toBe(true);
  });

  it('allows regenerating an untagged row on a premade text', () => {
    // Rows written before provenance tagging existed. On premade content there
    // is no user wording to lose, so the version sweep may still upgrade them.
    expect(mayRegenerateTranslation(premade, {})).toBe(true);
  });

  it('refuses human-authored rows even on premade texts', () => {
    // Curated rows live on premade texts, so the userCreated half of the guard
    // does not cover them — a translationVersion bump must not undo curation.
    expect(
      mayRegenerateTranslation(premade, {
        translationSource: CURATED_TRANSLATION_SOURCE,
      }),
    ).toBe(false);
    expect(
      mayRegenerateTranslation(premade, {
        translationSource: USER_PROVIDED_TRANSLATION_SOURCE,
      }),
    ).toBe(false);
  });

  it('refuses every row on a user-created text, whatever produced it', () => {
    // The case the reporter hit: chat-approved cards carry the chat model's
    // slug, and older custom cards carry no tag at all. Ownership of the CARD
    // decides, not the provenance of the row.
    for (const translationSource of [
      'openai/gpt-5-chat-none',
      'google/gemini-3.1-flash-lite-high',
      GOOGLE_TRANSLATE_SOURCE,
      USER_PROVIDED_TRANSLATION_SOURCE,
      undefined,
    ]) {
      expect(mayRegenerateTranslation(userOwned, { translationSource })).toBe(false);
    }
  });
});
