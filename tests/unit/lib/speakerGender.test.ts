import { describe, it, expect } from 'vitest';
import {
  SPEAKER_GENDER_FEATURE_ENABLED,
  resolveEffectiveSpeakerGender,
  courseMarksSpeakerGender,
  translationGenderSlot,
  pickTranslationVariant,
  pickCanonicalTranslationRow,
} from '@/lib/speakerGender';
import { resolveAudioSpeakerGender } from '@/lib/voices';

// Deterministic seeds picked so the canonical flip lands on a known value.
const SEED = 'text_abc123';
const CANONICAL_FOR_SEED = resolveAudioSpeakerGender(undefined, SEED);

describe('resolveEffectiveSpeakerGender', () => {
  it('definitive text gender always wins, even against a preference', () => {
    // The pin rule: uploads and inherently gendered content keep their
    // gender no matter what the user prefers.
    expect(
      resolveEffectiveSpeakerGender(
        { speakerGender: 'female', audioSpeakerGender: 'female' },
        SEED,
        'male',
      ),
    ).toBe('female');
    expect(
      resolveEffectiveSpeakerGender({ speakerGender: 'male' }, SEED, 'female'),
    ).toBe('male');
  });

  it('preference applies to neutral/unclassified texts', () => {
    expect(
      resolveEffectiveSpeakerGender(
        { speakerGender: 'neutral', audioSpeakerGender: 'male' },
        SEED,
        'female',
      ),
    ).toBe('female');
    expect(resolveEffectiveSpeakerGender({}, SEED, 'male')).toBe('male');
  });

  it('mixed / no preference resolves to the canonical assignment', () => {
    expect(
      resolveEffectiveSpeakerGender(
        { speakerGender: 'neutral', audioSpeakerGender: 'male' },
        SEED,
        'mixed',
      ),
    ).toBe('male');
    expect(
      resolveEffectiveSpeakerGender(
        { audioSpeakerGender: 'female' },
        SEED,
        undefined,
      ),
    ).toBe('female');
  });

  it('falls back to the deterministic seeded flip when nothing is stored', () => {
    expect(resolveEffectiveSpeakerGender({}, SEED, 'mixed')).toBe(
      CANONICAL_FOR_SEED,
    );
    expect(resolveEffectiveSpeakerGender({}, SEED, undefined)).toBe(
      CANONICAL_FOR_SEED,
    );
    // Same seed, same answer — concurrent callers must agree.
    expect(resolveEffectiveSpeakerGender({}, SEED, undefined)).toBe(
      resolveEffectiveSpeakerGender({}, SEED, undefined),
    );
  });

  it('ignores junk values in the loose text fields', () => {
    expect(
      resolveEffectiveSpeakerGender(
        { speakerGender: 'unknown', audioSpeakerGender: 'weird' },
        SEED,
        'female',
      ),
    ).toBe('female');
    expect(
      resolveEffectiveSpeakerGender(
        { speakerGender: 'unknown', audioSpeakerGender: 'weird' },
        SEED,
        'mixed',
      ),
    ).toBe(CANONICAL_FOR_SEED);
  });
});

describe('courseMarksSpeakerGender', () => {
  it('true when any course language marks speaker gender', () => {
    expect(courseMarksSpeakerGender(['en'], ['es'])).toBe(
      SPEAKER_GENDER_FEATURE_ENABLED,
    );
    expect(courseMarksSpeakerGender(['ru'], ['zh'])).toBe(
      SPEAKER_GENDER_FEATURE_ENABLED,
    );
    expect(courseMarksSpeakerGender(['en', 'de'], ['th'])).toBe(
      SPEAKER_GENDER_FEATURE_ENABLED,
    );
  });

  it('false when no course language marks speaker gender', () => {
    expect(courseMarksSpeakerGender(['en'], ['zh'])).toBe(false);
    expect(courseMarksSpeakerGender(['de'], ['tr', 'fi'])).toBe(false);
    expect(courseMarksSpeakerGender([], [])).toBe(false);
  });
});

describe('translationGenderSlot', () => {
  it('marked languages store the concrete gender', () => {
    expect(translationGenderSlot('es', 'female')).toBe('female');
    expect(translationGenderSlot('ru', 'male')).toBe('male');
    expect(translationGenderSlot('th', 'female')).toBe('female');
  });

  it('unmarked languages always store neutral — never undefined', () => {
    expect(translationGenderSlot('de', 'female')).toBe('neutral');
    expect(translationGenderSlot('zh', 'male')).toBe('neutral');
    expect(translationGenderSlot('xx', 'male')).toBe('neutral');
  });
});

type Row = { speakerGender?: string; id: string };
const row = (id: string, speakerGender?: string): Row => ({
  id,
  speakerGender,
});

describe('pickTranslationVariant', () => {
  it('empty rows: nothing to show, not satisfied', () => {
    expect(pickTranslationVariant([], 'es', 'female', 'male')).toEqual({
      row: null,
      satisfied: false,
    });
  });

  describe('unmarked language (stamps are meaningless)', () => {
    it('any row satisfies, preferring neutral then legacy-unstamped', () => {
      const rows = [row('a', 'male'), row('b'), row('c', 'neutral')];
      expect(pickTranslationVariant(rows, 'de', 'female', 'male')).toEqual({
        row: rows[2],
        satisfied: true,
      });
      const noNeutral = [row('a', 'male'), row('b')];
      expect(pickTranslationVariant(noNeutral, 'de', 'female', 'male')).toEqual(
        { row: noNeutral[1], satisfied: true },
      );
      const onlyStamped = [row('a', 'male')];
      expect(
        pickTranslationVariant(onlyStamped, 'de', 'female', 'male'),
      ).toEqual({ row: onlyStamped[0], satisfied: true });
    });
  });

  describe('marked language', () => {
    it('exact stamp match satisfies', () => {
      const rows = [row('m', 'male'), row('f', 'female')];
      expect(pickTranslationVariant(rows, 'es', 'female', 'male')).toEqual({
        row: rows[1],
        satisfied: true,
      });
      expect(pickTranslationVariant(rows, 'es', 'male', 'male')).toEqual({
        row: rows[0],
        satisfied: true,
      });
    });

    it('a neutral row (collapsed invariant sentence) satisfies both genders', () => {
      const rows = [row('n', 'neutral')];
      expect(pickTranslationVariant(rows, 'es', 'female', 'male')).toEqual({
        row: rows[0],
        satisfied: true,
      });
      expect(pickTranslationVariant(rows, 'es', 'male', 'male')).toEqual({
        row: rows[0],
        satisfied: true,
      });
    });

    it('legacy unstamped row is the canonical carrier: satisfies only the canonical gender', () => {
      const rows = [row('legacy')];
      expect(pickTranslationVariant(rows, 'es', 'male', 'male')).toEqual({
        row: rows[0],
        satisfied: true,
      });
      // Opposite of canonical: still DISPLAYED (card never blank), but the
      // ensure pass must generate the female variant.
      expect(pickTranslationVariant(rows, 'es', 'female', 'male')).toEqual({
        row: rows[0],
        satisfied: false,
      });
    });

    it('opposite-gender row is a display fallback only', () => {
      const rows = [row('m', 'male')];
      expect(pickTranslationVariant(rows, 'es', 'female', 'male')).toEqual({
        row: rows[0],
        satisfied: false,
      });
    });

    it('exact match beats neutral beats legacy', () => {
      const rows = [row('legacy'), row('n', 'neutral'), row('f', 'female')];
      expect(
        pickTranslationVariant(rows, 'es', 'female', 'male').row?.id,
      ).toBe('f');
      expect(pickTranslationVariant(rows, 'es', 'male', 'male').row?.id).toBe(
        'n',
      );
    });
  });
});

describe('pickCanonicalTranslationRow', () => {
  it('is the preference-independent pick at the canonical gender', () => {
    const rows = [row('m', 'male'), row('f', 'female')];
    expect(pickCanonicalTranslationRow(rows, 'es', 'male')?.id).toBe('m');
    expect(pickCanonicalTranslationRow(rows, 'es', 'female')?.id).toBe('f');
    expect(pickCanonicalTranslationRow([], 'es', 'male')).toBeNull();
  });
});
